/**
 * Questions (docs/design.md §4.4): everything that waits on someone. A
 * member's calls outside its rules and its questions with choices
 * (AskUserQuestion) come here through the Agent SDK's `canUseTool`, wait in
 * "Needs you" until you answer, and are called off when the member's turn
 * ends first. Decisions on a subtask wait there too, with no turn behind
 * them: the scheduler acts on your answer. Answered and called-off questions
 * leave the state; nothing here changes a subtask.
 */
import { randomUUID } from "node:crypto";
import type {
  CanUseTool,
  PermissionResult,
  PermissionRuleValue,
} from "@anthropic-ai/claude-agent-sdk";
import type { AskUserQuestionInput } from "@anthropic-ai/claude-agent-sdk/sdk-tools";
import {
  noteNeeded,
  type Ask,
  type Choice,
  type Decision,
  type DecisionOption,
  type PermissionOption,
  type Question,
  type Subtask,
  type GoalState,
} from "./types.ts";

/** Claude Code's own tool for questions with choices. */
const ASK_TOOL = "AskUserQuestion";

/** What a member hears when its wait is called off: its turn ended first. */
const CALLED_OFF = "Stopped.";

/** A member waiting, on a subtask's run, until `signal` ends the run. */
interface Asker {
  from: string;
  subtaskId: string;
  signal: AbortSignal;
}

/**
 * Your answer, of the question's kind: one of a permission request's options
 * (denying, with a note), one pick per question with choices, or one of a
 * decision's options (sending a task back, what to change in `note`, and
 * which of its done subtasks goes back in `sentBack`). An empty note is none.
 */
export type Answer =
  | { kind: "permission"; option: PermissionOption; note?: string }
  | { kind: "choices"; picks: string[] }
  | { kind: "decision"; option: DecisionOption; note?: string; sentBack?: string };

/** Your answer to a decision, which the scheduler carries out. */
export type DecisionAnswer = Extract<Answer, { kind: "decision" }>;

/** What questions need from the engine. */
export interface Inbox {
  state: Pick<GoalState, "questions" | "subtasks">;
  /** The state changed. */
  changed(): void;
  /** Adds allow rules to the team's `settings.json` (§6), for every member's next turns. */
  allowAlways(rules: string[]): Promise<void>;
}

type Request = Parameters<CanUseTool>[2];

/** A permission rule as settings files write it: `Bash(npm test)`, or the bare tool. */
const ruleText = ({ toolName, ruleContent }: PermissionRuleValue) =>
  ruleContent === undefined ? toolName : `${toolName}(${ruleContent})`;

/**
 * The allow rules Claude Code suggests for a call, for "always". None when it
 * says a rule would grant more than the call, or an ask rule forced the
 * prompt: you asked to be asked every time, and no allow rule outranks that.
 */
const alwaysRules = (request: Request): PermissionRuleValue[] =>
  request.matchedAskRule || request.suppressAlwaysAllowRule
    ? []
    : (request.suggestions ?? []).flatMap((update) =>
        update.type === "addRules" && update.behavior === "allow" ? update.rules : [],
      );

export class Questions {
  /** Questions a member's turn waits on: question id → resume it (undefined: called off). */
  private waiting = new Map<string, (answer: Answer | undefined) => void>();

  constructor(private readonly inbox: Inbox) {}

  /**
   * The `canUseTool` of a member's turn: its questions with choices and
   * every call its rules don't cover wait for you, and are called off when
   * its run ends (`asker.signal`) or the SDK withdraws the request.
   */
  gate(asker: Asker): CanUseTool {
    return (tool, input, request) => {
      const who = { ...asker, signal: AbortSignal.any([asker.signal, request.signal]) };
      return tool === ASK_TOOL
        ? this.ask(who, input as unknown as AskUserQuestionInput)
        : this.permit(who, tool, input, request);
    };
  }

  /**
   * Answers a question put to you, and gives it back: a decision is the
   * scheduler's to act on. Throws when it is no longer open, or the answer
   * doesn't fit it: not one of its options, not one pick per question, a
   * task sent back without what to change, or with a subtask not done in it.
   */
  answer(id: string, answer: Answer): Question {
    const question = this.inbox.state.questions.find((q) => q.id === id && q.kind !== "teammate");
    if (!question) throw new Error("That question is no longer open.");
    if (!this.fits(question, answer)) throw new Error("That answer doesn't fit the question.");
    this.close(question, answer);
    return question;
  }

  /**
   * A member asks a teammate: the question is open while `answering` runs
   * (the teammate's read-only turn), so the asker shows as waiting on them,
   * and leaves the state when it settles. Its subtask's run stopping calls it
   * off (cancelFor) and should stop `answering` too.
   */
  async toTeammate<T>(
    asker: Omit<Asker, "signal">,
    to: string,
    text: string,
    answering: () => Promise<T>,
  ): Promise<T> {
    const question = this.open(asker, { text, kind: "teammate", to });
    try {
      return await answering();
    } finally {
      // Called off meanwhile, it left already.
      if (this.inbox.state.questions.includes(question)) this.close(question);
    }
  }

  /**
   * A stuck review, a merge that needs you, or a task done (with why, or
   * what, in `text`): it waits for your answer, no turn behind it.
   */
  openDecision(subtask: Subtask, decision: Decision, text: string) {
    this.open(
      { from: subtask.assignee, subtaskId: subtask.id },
      { text, kind: "decision", decision },
    );
  }

  /**
   * Calls off what a subtask's run waits on (the run ended or was stopped);
   * with `decisions`, also your decisions on its review or merge (it left
   * that stage).
   */
  cancelFor(subtaskId: string, decisions = false) {
    this.cancelAll((q) => q.subtaskId === subtaskId && (decisions || q.kind !== "decision"));
  }

  /** After a restart no turn waits on anything: what members asked is called off; your decisions stand. */
  recover() {
    this.cancelAll((q) => q.kind !== "decision");
  }

  /** Calls off a task's delivery waiting on you: work in it is being done again. */
  cancelDelivery(taskId: string) {
    const inTask = new Set(
      this.inbox.state.subtasks.filter((s) => s.taskId === taskId).map((s) => s.id),
    );
    this.cancelAll(
      (q) => q.kind === "decision" && q.decision.kind === "delivery" && inTask.has(q.subtaskId),
    );
  }

  /** A call the member's rules don't cover: allowed once, always, or denied. */
  private async permit(
    asker: Asker,
    tool: string,
    input: Record<string, unknown>,
    request: Request,
  ): Promise<PermissionResult> {
    const rules = alwaysRules(request);
    const answer = await this.wait<Extract<Answer, { kind: "permission" }>>(asker, {
      // A command comes with the member's own words for what it does.
      text: request.description ?? "",
      kind: "permission",
      permission: {
        tool,
        input,
        options: rules.length ? ["once", "always", "deny"] : ["once", "deny"],
      },
    });
    if (!answer) return { behavior: "deny", message: CALLED_OFF };
    switch (answer.option) {
      case "once":
        return { behavior: "allow", updatedInput: input };
      case "always":
        await this.inbox.allowAlways(rules.map(ruleText));
        // The team's settings reach the next turns; this one goes on under the rules from here.
        return {
          behavior: "allow",
          updatedInput: input,
          updatedPermissions: [
            { type: "addRules", rules, behavior: "allow", destination: "session" },
          ],
        };
      case "deny":
        return {
          behavior: "deny",
          message: answer.note
            ? `The user denied this and said: ${answer.note}`
            : "The user denied this.",
        };
    }
  }

  /** Questions with choices: your picks go back as the tool's answers. */
  private async ask(asker: Asker, input: AskUserQuestionInput): Promise<PermissionResult> {
    const choices: Choice[] = input.questions.map((q) => ({
      question: q.question,
      header: q.header,
      options: q.options.map((o) => ({
        label: o.label,
        description: o.description,
        ...(o.preview !== undefined && { preview: o.preview }),
      })),
      multiSelect: q.multiSelect,
    }));
    const answer = await this.wait<Extract<Answer, { kind: "choices" }>>(asker, {
      text: choices.map((c) => c.question).join("\n"),
      kind: "choices",
      choices,
    });
    if (!answer) return { behavior: "deny", message: CALLED_OFF };
    const answers = Object.fromEntries(choices.map((c, i) => [c.question, answer.picks[i]]));
    return { behavior: "allow", updatedInput: { ...input, answers } };
  }

  /** Whether `answer` is one `question` can take. */
  private fits(question: Question, answer: Answer): boolean {
    switch (question.kind) {
      case "permission":
        return answer.kind === "permission" && question.permission.options.includes(answer.option);
      case "choices":
        return answer.kind === "choices" && answer.picks.length === question.choices.length;
      case "decision":
        return (
          answer.kind === "decision" &&
          question.decision.options.includes(answer.option) &&
          (Boolean(answer.note) || !noteNeeded(question.decision, answer.option)) &&
          (answer.option !== "revise" || this.revisable(question, answer))
        );
      case "teammate":
        return false;
    }
  }

  /** Sending a task back sends back only one of its subtasks that is done. */
  private revisable(question: Question, answer: DecisionAnswer) {
    if (answer.sentBack === undefined) return true;
    const { subtasks } = this.inbox.state;
    const taskId = subtasks.find((s) => s.id === question.subtaskId)?.taskId;
    const target = subtasks.find((s) => s.id === answer.sentBack);
    return target !== undefined && target.taskId === taskId && target.status === "done";
  }

  /**
   * Puts a question to you and waits for your answer (answer() checks it
   * fits). Undefined when the asker stops waiting first.
   */
  private wait<A extends Answer>(
    asker: Asker,
    ask: { text: string } & Exclude<Ask, { kind: "teammate" | "decision" }>,
  ): Promise<A | undefined> {
    // Stopped before it got here: an abort listener would never fire.
    if (asker.signal.aborted) return Promise.resolve(undefined);
    const question = this.open(asker, ask);
    return new Promise((resolve) => {
      const callOff = () => {
        this.close(question);
      };
      asker.signal.addEventListener("abort", callOff, { once: true });
      this.waiting.set(question.id, (answer) => {
        asker.signal.removeEventListener("abort", callOff);
        resolve(answer as A | undefined);
      });
    });
  }

  /** Puts a question: to a teammate, or to you. */
  private open(asker: Omit<Asker, "signal">, ask: { text: string } & Ask): Question {
    const question: Question = {
      id: randomUUID(),
      subtaskId: asker.subtaskId,
      from: asker.from,
      ...ask,
    };
    this.inbox.state.questions.push(question);
    this.inbox.changed();
    return question;
  }

  /** Calls off every open question that `which` picks. */
  private cancelAll(which: (question: Question) => boolean) {
    // Picked out first: each one called off leaves the list.
    const picked = this.inbox.state.questions.filter(which);
    for (const question of picked) this.close(question);
  }

  /** Answers or calls off a question: it leaves the state, and whoever waits on it hears. */
  private close(question: Question, answer?: Answer) {
    this.waiting.get(question.id)?.(answer);
    this.waiting.delete(question.id);
    this.inbox.state.questions = this.inbox.state.questions.filter((q) => q !== question);
    this.inbox.changed();
  }
}

/**
 * Questions (docs/design.md §4.4): everything that waits on someone. A
 * member's calls outside its rules and its questions with choices
 * (AskUserQuestion) come here through the Agent SDK's `canUseTool`, wait in
 * "Needs you" until you answer, and are called off when the member's turn
 * ends first. Answered and called-off questions leave the state.
 */
import { randomUUID } from "node:crypto";
import type {
  CanUseTool,
  PermissionResult,
  PermissionRuleValue,
} from "@anthropic-ai/claude-agent-sdk";
import type { AskUserQuestionInput } from "@anthropic-ai/claude-agent-sdk/sdk-tools";
import { QUESTION_MACHINE, step } from "./machines.ts";
import { YOU, type Choice, type PermissionOption, type Question, type TeamState } from "./types.ts";

/** Claude Code's own tool for questions with choices. */
const ASK_TOOL = "AskUserQuestion";

/** What a member hears when its wait is called off: its turn ended first. */
const CALLED_OFF = "Stopped.";

/** A member waiting, on a subtask's run, until `signal` ends the run. */
export interface Asker {
  from: string;
  subtaskId?: string;
  signal: AbortSignal;
}

/** Your answer: one of a permission request's options, or one pick per question with choices. */
export type Answer = { option: PermissionOption; note?: string } | { picks: string[] };

/** What questions need from the engine. */
export interface Inbox {
  state: Pick<TeamState, "questions">;
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
   * Answers a question put to you. Throws when it is no longer open, or the
   * answer doesn't fit it: not one of its options, or not one pick per question.
   */
  answer(id: string, answer: Answer) {
    const question = this.inbox.state.questions.find(
      (q) => q.id === id && q.to === YOU && q.status === "open",
    );
    if (!question) throw new Error("That question is no longer open.");
    const fits = question.permission
      ? "option" in answer && question.permission.options.includes(answer.option)
      : "picks" in answer && answer.picks.length === question.choices?.length;
    if (!fits) throw new Error("That answer doesn't fit the question.");
    this.close(question, "answer", answer);
  }

  /** A call the member's rules don't cover: allowed once, always, or denied. */
  private async permit(
    asker: Asker,
    tool: string,
    input: Record<string, unknown>,
    request: Request,
  ): Promise<PermissionResult> {
    const rules = alwaysRules(request);
    const answer = await this.wait<Extract<Answer, { option: PermissionOption }>>(asker, {
      // A command comes with the member's own words for what it does.
      text: request.description ?? "",
      options: [],
      permission: {
        tool,
        input,
        ...(request.title !== undefined && { title: request.title }),
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
    const answer = await this.wait<Extract<Answer, { picks: string[] }>>(asker, {
      text: choices.map((c) => c.question).join("\n"),
      options: [],
      choices,
    });
    if (!answer) return { behavior: "deny", message: CALLED_OFF };
    const answers = Object.fromEntries(choices.map((c, i) => [c.question, answer.picks[i]]));
    return { behavior: "allow", updatedInput: { ...input, answers } };
  }

  /**
   * Puts a question to you and waits for your answer (answer() checks it
   * fits). Undefined when the asker stops waiting first.
   */
  private wait<A extends Answer>(
    asker: Asker,
    ask: Pick<Question, "text" | "options" | "choices" | "permission">,
  ): Promise<A | undefined> {
    // Stopped before it got here: an abort listener would never fire.
    if (asker.signal.aborted) return Promise.resolve(undefined);
    const question: Question = {
      id: randomUUID(),
      ...(asker.subtaskId !== undefined && { subtaskId: asker.subtaskId }),
      from: asker.from,
      to: YOU,
      status: "open",
      createdAt: Date.now(),
      ...ask,
    };
    this.inbox.state.questions.push(question);
    this.inbox.changed();
    return new Promise((resolve) => {
      const callOff = () => {
        this.close(question, "cancel");
      };
      asker.signal.addEventListener("abort", callOff, { once: true });
      this.waiting.set(question.id, (answer) => {
        asker.signal.removeEventListener("abort", callOff);
        resolve(answer as A | undefined);
      });
    });
  }

  /** Answers or calls off a question: it leaves the state, and whoever waits on it hears. */
  private close(question: Question, event: keyof typeof QUESTION_MACHINE, answer?: Answer) {
    question.status = step(QUESTION_MACHINE, question.status, event);
    this.waiting.get(question.id)?.(answer);
    this.waiting.delete(question.id);
    this.inbox.state.questions = this.inbox.state.questions.filter((q) => q !== question);
    this.inbox.changed();
  }
}

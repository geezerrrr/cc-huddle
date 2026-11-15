import type { CanUseTool, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { Questions, type Inbox } from "./questions.ts";
import { DECISIONS, type Question, type Subtask } from "./types.ts";

/** An inbox over an empty state, recording the rules allowed always. */
function inbox() {
  const allowed: string[][] = [];
  const box: Inbox = {
    state: { questions: [] },
    changed: vi.fn(),
    allowAlways: (rules) => {
      allowed.push(rules);
      return Promise.resolve();
    },
  };
  const questions = new Questions(box);
  /** Every open question: your decisions in the state, and what turns wait on. */
  const open = (): Question[] => [...box.state.questions, ...questions.now()];
  return { allowed, questions, open };
}

/** What canUseTool is given beside the call, as Claude Code sends it. */
const request = (fields: Partial<Parameters<CanUseTool>[2]> = {}) => ({
  signal: new AbortController().signal,
  toolUseID: "tu_1",
  requestId: "r1",
  ...fields,
});

const ruleFor: PermissionUpdate = {
  type: "addRules",
  rules: [{ toolName: "Bash", ruleContent: "pnpm test" }],
  behavior: "allow",
  destination: "localSettings",
};
const command = { command: "pnpm test", description: "Run the tests" };

/** The question that came in, once it has. */
function opened(open: () => Question[]): Promise<Question> {
  return vi.waitFor(() => {
    const [question] = open();
    if (!question) throw new Error("No question yet");
    return question;
  });
}

describe("a call outside the rules", () => {
  it("waits for you, and once allowed leaves the inbox", async () => {
    const { open, questions } = inbox();
    const gate = questions.gate({
      from: "glm",
      subtaskId: "s1",
      signal: new AbortController().signal,
    });
    const result = gate("Bash", command, request({ description: "Run the tests" }));
    const question = await opened(open);
    expect(question).toMatchObject({
      from: "glm",
      subtaskId: "s1",
      text: "Run the tests",
      kind: "permission",
      permission: { tool: "Bash", input: command, options: ["once", "deny"] },
    });
    questions.answer(question.id, { kind: "permission", option: "once" });
    expect(await result).toEqual({ behavior: "allow", updatedInput: command });
    expect(open()).toEqual([]);
  });

  it("allowed always, saves the rule Claude Code suggests for the team and this turn", async () => {
    const { open, allowed, questions } = inbox();
    const gate = questions.gate({
      from: "glm",
      subtaskId: "s1",
      signal: new AbortController().signal,
    });
    const result = gate("Bash", command, request({ suggestions: [ruleFor] }));
    const question = await opened(open);
    expect(question).toMatchObject({ permission: { options: ["once", "always", "deny"] } });
    questions.answer(question.id, { kind: "permission", option: "always" });
    expect(await result).toEqual({
      behavior: "allow",
      updatedInput: command,
      updatedPermissions: [{ ...ruleFor, destination: "session" }],
    });
    expect(allowed).toEqual([["Bash(pnpm test)"]]);
  });

  it("offers no always where a rule would grant more, or an ask rule forced the prompt", async () => {
    const { open, questions } = inbox();
    const gate = questions.gate({
      from: "glm",
      subtaskId: "s1",
      signal: new AbortController().signal,
    });
    void gate("Bash", command, request({ suggestions: [ruleFor], suppressAlwaysAllowRule: true }));
    void gate(
      "Bash",
      command,
      request({
        suggestions: [ruleFor],
        matchedAskRule: { source: "userSettings", toolName: "Bash" },
      }),
    );
    await vi.waitFor(() => {
      expect(open()).toHaveLength(2);
    });
    for (const q of open()) expect(q).toMatchObject({ permission: { options: ["once", "deny"] } });
  });

  it("denied, tells the member what you said", async () => {
    const { open, questions } = inbox();
    const gate = questions.gate({
      from: "glm",
      subtaskId: "s1",
      signal: new AbortController().signal,
    });
    const result = gate("Bash", command, request());
    questions.answer((await opened(open)).id, {
      kind: "permission",
      option: "deny",
      note: "use vitest directly",
    });
    expect(await result).toEqual({
      behavior: "deny",
      message: "The user denied this and said: use vitest directly",
    });
  });

  it("is called off when the member's run ends first", async () => {
    const { open, questions } = inbox();
    const run = new AbortController();
    const result = questions.gate({ from: "glm", subtaskId: "s1", signal: run.signal })(
      "Bash",
      command,
      request(),
    );
    await opened(open);
    run.abort();
    expect(await result).toEqual({ behavior: "deny", message: "Stopped." });
    expect(open()).toEqual([]);
  });
});

describe("questions with choices", () => {
  const input = {
    questions: [
      {
        question: "Where does the score go?",
        header: "Score",
        options: [
          { label: "Top right", description: "Out of the way" },
          { label: "Center", description: "Big", preview: "```\n  12  \n```" },
        ],
        multiSelect: false,
      },
      {
        question: "Which sounds?",
        header: "Sound",
        options: [
          { label: "Roll", description: "" },
          { label: "Win", description: "" },
        ],
        multiSelect: true,
      },
    ],
  };

  it("go back to the member as the tool's answers", async () => {
    const { open, questions } = inbox();
    const gate = questions.gate({
      from: "glm",
      subtaskId: "s1",
      signal: new AbortController().signal,
    });
    const result = gate("AskUserQuestion", input, request());
    const question = await opened(open);
    expect(question.text).toBe("Where does the score go?\nWhich sounds?");
    expect(question).toMatchObject({ choices: input.questions });
    questions.answer(question.id, { kind: "choices", picks: ["Center", "Roll, Win"] });
    expect(await result).toEqual({
      behavior: "allow",
      updatedInput: {
        ...input,
        answers: { "Where does the score go?": "Center", "Which sounds?": "Roll, Win" },
      },
    });
  });

  it("take one pick per question", async () => {
    const { open, questions } = inbox();
    void questions.gate({ from: "glm", subtaskId: "s1", signal: new AbortController().signal })(
      "AskUserQuestion",
      input,
      request(),
    );
    const question = await opened(open);
    expect(() => {
      questions.answer(question.id, { kind: "choices", picks: ["Center"] });
    }).toThrow("doesn't fit");
    expect(() => {
      questions.answer(question.id, { kind: "permission", option: "once" });
    }).toThrow("doesn't fit");
  });
});

describe("answer", () => {
  it("refuses a question that is no longer open", () => {
    const { questions } = inbox();
    expect(() => {
      questions.answer("gone", { kind: "permission", option: "once" });
    }).toThrow("no longer open");
  });

  it("refuses an option the request didn't offer", async () => {
    const { open, questions } = inbox();
    void questions.gate({ from: "glm", subtaskId: "s1", signal: new AbortController().signal })(
      "Bash",
      command,
      request(),
    );
    const question = await opened(open);
    expect(() => {
      questions.answer(question.id, { kind: "permission", option: "always" });
    }).toThrow("doesn't fit");
  });
});

const subtask = (id: string, fields: Partial<Subtask> = {}): Subtask => ({
  id,
  taskId: "t1",
  title: id,
  description: "",
  acceptance: "",
  assignee: "glm",
  dependsOn: [],
  status: "done",
  progress: { done: 0, total: 0 },
  ...fields,
});

describe("decisions", () => {
  it("wait for you with no turn behind them, and come back answered", async () => {
    const { open, questions } = inbox();
    questions.openDecision(
      subtask("s1", { status: "reviewing" }),
      DECISIONS.stuckReview(),
      "Sent back three times",
    );
    const question = await opened(open);
    expect(question).toMatchObject({ from: "glm", subtaskId: "s1", kind: "decision" });
    expect(() => {
      questions.answer(question.id, { kind: "permission", option: "once" });
    }).toThrow("doesn't fit");
    questions.answer(question.id, { kind: "decision", option: "skip" });
    expect(open()).toEqual([]);
  });

  it("send a task back only with what to change", async () => {
    const { open, questions } = inbox();
    questions.openDecision(subtask("s1"), DECISIONS.delivery(), "Dice game");
    const { id } = await opened(open);
    expect(() => {
      questions.answer(id, { kind: "decision", option: "revise" });
    }).toThrow("doesn't fit");
    questions.answer(id, { kind: "decision", option: "revise", note: "Bigger dice" });
    expect(open()).toEqual([]);
  });
});

describe("calling off", () => {
  it("a subtask's questions frees its waiting turn, and its decisions only when asked to", async () => {
    const { open, questions } = inbox();
    const asked = questions.gate({
      from: "glm",
      subtaskId: "s1",
      signal: new AbortController().signal,
    })("Bash", command, request());
    questions.openDecision(subtask("s1"), DECISIONS.failedMerge(), "git failed");
    await vi.waitFor(() => {
      expect(open()).toHaveLength(2);
    });
    questions.cancelFor("s1");
    expect(await asked).toEqual({ behavior: "deny", message: "Stopped." });
    expect(open()).toMatchObject([{ decision: { kind: "merge" } }]);
    questions.cancelFor("s1", true);
    expect(open()).toEqual([]);
  });

  it("a task's delivery leaves its other decisions", () => {
    const { open, questions } = inbox();
    questions.openDecision(subtask("s1"), DECISIONS.delivery(), "");
    questions.openDecision(subtask("x", { taskId: "t2" }), DECISIONS.delivery(), "");
    questions.cancelDelivery(["s1", "s2"]);
    expect(open().map((q) => q.subtaskId)).toEqual(["x"]);
  });
});

describe("a teammate's question", () => {
  it("is open while the teammate answers, and leaves once they have", async () => {
    const { open, questions } = inbox();
    const { promise, resolve } = Promise.withResolvers<string>();
    const answered = questions.toTeammate(
      { from: "glm", subtaskId: "s1" },
      "sonnet",
      "Which font?",
      () => promise,
    );
    expect(open()).toMatchObject([
      { from: "glm", to: "sonnet", subtaskId: "s1", text: "Which font?" },
    ]);
    resolve("Inter");
    expect(await answered).toBe("Inter");
    expect(open()).toEqual([]);
  });

  it("leaves when its subtask's run is stopped, the answer still coming", async () => {
    const { open, questions } = inbox();
    const failing = questions.toTeammate({ from: "glm", subtaskId: "s1" }, "sonnet", "?", () =>
      Promise.reject(new Error("stopped")),
    );
    questions.cancelFor("s1");
    expect(open()).toEqual([]);
    await expect(failing).rejects.toThrow("stopped");
  });
});

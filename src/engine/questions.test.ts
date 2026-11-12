import type { CanUseTool, PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { Questions, type Inbox } from "./questions.ts";
import type { Question } from "./types.ts";

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
  return { box, allowed, questions: new Questions(box) };
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
function opened(box: Inbox): Promise<Question> {
  return vi.waitFor(() => {
    const [question] = box.state.questions;
    if (!question) throw new Error("No question yet");
    return question;
  });
}

describe("a call outside the rules", () => {
  it("waits for you, and once allowed leaves the inbox", async () => {
    const { box, questions } = inbox();
    const gate = questions.gate({
      from: "glm",
      subtaskId: "s1",
      signal: new AbortController().signal,
    });
    const result = gate("Bash", command, request({ description: "Run the tests" }));
    const question = await opened(box);
    expect(question).toMatchObject({
      from: "glm",
      to: "you",
      subtaskId: "s1",
      text: "Run the tests",
      permission: { tool: "Bash", input: command, options: ["once", "deny"] },
    });
    questions.answer(question.id, { option: "once" });
    expect(await result).toEqual({ behavior: "allow", updatedInput: command });
    expect(box.state.questions).toEqual([]);
  });

  it("allowed always, saves the rule Claude Code suggests for the team and this turn", async () => {
    const { box, allowed, questions } = inbox();
    const gate = questions.gate({ from: "glm", signal: new AbortController().signal });
    const result = gate("Bash", command, request({ suggestions: [ruleFor] }));
    const question = await opened(box);
    expect(question.permission?.options).toEqual(["once", "always", "deny"]);
    questions.answer(question.id, { option: "always" });
    expect(await result).toEqual({
      behavior: "allow",
      updatedInput: command,
      updatedPermissions: [{ ...ruleFor, destination: "session" }],
    });
    expect(allowed).toEqual([["Bash(pnpm test)"]]);
  });

  it("offers no always where a rule would grant more, or an ask rule forced the prompt", async () => {
    const { box, questions } = inbox();
    const gate = questions.gate({ from: "glm", signal: new AbortController().signal });
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
      expect(box.state.questions).toHaveLength(2);
    });
    for (const q of box.state.questions) expect(q.permission?.options).toEqual(["once", "deny"]);
  });

  it("denied, tells the member what you said", async () => {
    const { box, questions } = inbox();
    const gate = questions.gate({ from: "glm", signal: new AbortController().signal });
    const result = gate("Bash", command, request());
    questions.answer((await opened(box)).id, { option: "deny", note: "use vitest directly" });
    expect(await result).toEqual({
      behavior: "deny",
      message: "The user denied this and said: use vitest directly",
    });
  });

  it("is called off when the member's run ends first", async () => {
    const { box, questions } = inbox();
    const run = new AbortController();
    const result = questions.gate({ from: "glm", signal: run.signal })("Bash", command, request());
    await opened(box);
    run.abort();
    expect(await result).toEqual({ behavior: "deny", message: "Stopped." });
    expect(box.state.questions).toEqual([]);
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
    const { box, questions } = inbox();
    const gate = questions.gate({ from: "glm", signal: new AbortController().signal });
    const result = gate("AskUserQuestion", input, request());
    const question = await opened(box);
    expect(question.text).toBe("Where does the score go?\nWhich sounds?");
    expect(question.choices).toEqual(input.questions);
    questions.answer(question.id, { picks: ["Center", "Roll, Win"] });
    expect(await result).toEqual({
      behavior: "allow",
      updatedInput: {
        ...input,
        answers: { "Where does the score go?": "Center", "Which sounds?": "Roll, Win" },
      },
    });
  });

  it("take one pick per question", async () => {
    const { box, questions } = inbox();
    void questions.gate({ from: "glm", signal: new AbortController().signal })(
      "AskUserQuestion",
      input,
      request(),
    );
    const question = await opened(box);
    expect(() => {
      questions.answer(question.id, { picks: ["Center"] });
    }).toThrow("doesn't fit");
    expect(() => {
      questions.answer(question.id, { option: "once" });
    }).toThrow("doesn't fit");
  });
});

describe("answer", () => {
  it("refuses a question that is no longer open", () => {
    const { questions } = inbox();
    expect(() => {
      questions.answer("gone", { option: "once" });
    }).toThrow("no longer open");
  });

  it("refuses an option the request didn't offer", async () => {
    const { box, questions } = inbox();
    void questions.gate({ from: "glm", signal: new AbortController().signal })(
      "Bash",
      command,
      request(),
    );
    const question = await opened(box);
    expect(() => {
      questions.answer(question.id, { option: "always" });
    }).toThrow("doesn't fit");
  });
});

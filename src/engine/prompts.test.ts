import { describe, expect, it } from "vitest";
import { goOnMessage, systemPrompt, taskBrief, teammateQuestion } from "./prompts.ts";
import type { Member, Subtask } from "./types.ts";

const member = (name: string, title: string): Member => ({
  name,
  role: { id: title.toLowerCase(), title, duties: `Duties of a ${title}.\n` },
  env: {},
});
const glm = member("glm", "UI designer");
const sonnet = member("sonnet", "Programmer");

const subtask = (id: string, fields: Partial<Subtask> = {}): Subtask => ({
  id,
  taskId: "t1",
  goalId: "g1",
  title: id,
  description: "",
  acceptance: "",
  assignee: "sonnet",
  dependsOn: [],
  status: "done",
  createdAt: 0,
  progress: { done: 0, total: 0 },
  tokens: 0,
  ...fields,
});

describe("systemPrompt", () => {
  it("says who the member is, their duties and their teammates", () => {
    const prompt = systemPrompt("answer", glm, [glm, sonnet]);
    expect(prompt).toContain("You are glm, the UI designer");
    expect(prompt).toContain("Your teammates: sonnet (Programmer).");
    expect(prompt).toContain("# Your duties\nDuties of a UI designer.");
    expect(prompt).not.toContain("deliver");
  });

  it("tells how to work on a subtask only in a working session", () => {
    expect(systemPrompt("task", glm, [glm])).toContain("call deliver");
  });
});

describe("taskBrief", () => {
  it("gives the work, where to do it, and what it builds on", () => {
    const brief = taskBrief({
      goal: { id: "g1", name: "Dice game", slug: "dice-game", status: "active", createdAt: 0 },
      task: { id: "t1", goalId: "g1", title: "Board", outcome: "A board to roll on", createdAt: 0 },
      subtask: subtask("Scoreboard", { acceptance: "Shows both scores" }),
      cwd: "/desks/s2",
      branch: "openplan/dice-game/s2",
      upstream: [
        {
          subtask: subtask("Rules", { delivery: { summary: "Done.", files: ["rules.ts"], at: 0 } }),
          direct: true,
        },
        {
          subtask: subtask("Setup", { delivery: { summary: "Set up.", files: [], at: 0 } }),
          direct: false,
        },
      ],
      revision: "Bigger numbers",
    });
    expect(brief).toBe(`Goal: Dice game
Task: Board. A board to roll on

Your subtask: Scoreboard

Acceptance criteria: Shows both scores

Your worktree is /desks/s2, on branch openplan/dice-game/s2.

It builds on this work, merged into the goal's branch:
- Rules, by sonnet: Done. Files: rules.ts

Which built on:
- Setup, by sonnet: Set up.

The user sent this task back before, asking for:
Bigger numbers`);
  });
});

describe("goOnMessage", () => {
  it("says each thing that came up once, in the order it came", () => {
    const message = goOnMessage(
      [{ why: "held" }, { why: "rejected" }, { why: "held" }, { why: "carried", note: "Use blue" }],
      subtask("s1", { review: { rounds: 1, notes: "Scores overlap" } }),
    );
    expect(message.split("\n\n")).toEqual([
      "Your work was paused and now goes on. Pick up where you left off.",
      "The review sent your delivery back. Fix what it says, then deliver again:\nScores overlap",
      "The user adds to your subtask:\nUse blue",
    ]);
  });
});

describe("teammateQuestion", () => {
  it("brings the question and what the member asked has done", () => {
    const prompt = teammateQuestion({
      from: glm,
      subtask: subtask("Scoreboard"),
      question: "Which font?",
      own: [subtask("Rules", { delivery: { summary: "Rules in rules.ts", files: [], at: 0 } })],
    });
    expect(prompt).toContain('glm (UI designer) asks you this while working on "Scoreboard"');
    expect(prompt).toContain("- Rules (done): Rules in rules.ts");
  });
});

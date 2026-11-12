import { describe, expect, it } from "vitest";
import type { Question, Subtask } from "../engine/types.ts";
import { statusText } from "./status.ts";

const subtask = (id: string, fields: Partial<Subtask>): Subtask => ({
  id,
  taskId: "t1",
  goalId: "g1",
  title: id,
  description: "",
  acceptance: "",
  assignee: "glm",
  dependsOn: [],
  status: "pending",
  createdAt: 0,
  progress: { done: 0, total: 0 },
  tokens: 0,
  ...fields,
});

const question = (id: string, fields: Partial<Question>): Question => ({
  id,
  from: "glm",
  to: "you",
  text: "",
  options: [],
  status: "open",
  createdAt: 0,
  ...fields,
});

describe("statusText", () => {
  it("tells each goal with its meetings and work, and what waits on you", () => {
    const text = statusText({
      members: ["glm", "sonnet"],
      goals: [{ id: "g1", name: "Dice", slug: "dice", status: "active", createdAt: 0 }],
      meetings: [
        {
          id: "m1",
          goalId: "g1",
          agenda: "Scoring",
          size: "small",
          participants: ["sonnet"],
          host: "sonnet",
          status: "review",
          turns: [],
          tokens: 0,
          createdAt: 0,
        },
      ],
      tasks: [{ id: "t1", goalId: "g1", title: "Game", outcome: "", createdAt: 0 }],
      subtasks: [
        subtask("Rules", {
          status: "running",
          progress: { done: 1, total: 3, current: "Write the rolls" },
        }),
        subtask("Board", { assignee: "sonnet", dependsOn: ["Rules"] }),
        subtask("Score", { status: "failed", error: "API Error: 529" }),
      ],
      questions: [
        question("q1", {
          subtaskId: "Rules",
          permission: { tool: "Bash", input: {}, title: "Run the tests", options: ["once"] },
        }),
        question("q2", {
          subtaskId: "Score",
          text: "Game",
          decision: { kind: "delivery", options: ["accept", "revise"] },
        }),
        question("q3", { status: "answered", text: "Old" }),
      ],
    });
    expect(text).toBe(`Team: glm (busy), sonnet

Goal "Dice" [g1]: active, on branch openplan/dice/main
  Meeting [m1] on "Scoring", hosted by sonnet: its plan waits for you: approve it, change it, or cancel it
  Task "Game" [t1]
    - Rules [Rules], glm: running, step 2 of 3: Write the rolls, waits on your answer
    - Board [Board], sonnet: pending, waits on "Rules" by glm
    - Score [Score], glm: failed, error: API Error: 529

Waiting on you:
  - [q1] glm asks to use Bash: Run the tests. Answer it in /openplan.
  - [q2] The task "Game" is done: accept, revise.`);
  });
});

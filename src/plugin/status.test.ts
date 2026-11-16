import { describe, expect, it } from "vitest";
import { DECISIONS, type Ask, type Question, type Subtask } from "../engine/types.ts";
import { statusText } from "./status.ts";

const subtask = (id: string, fields: Partial<Subtask>): Subtask => ({
  id,
  taskId: "t1",
  title: id,
  description: "",
  acceptance: "",
  assignee: "glm",
  dependsOn: [],
  status: "pending",
  progress: { done: 0, total: 0 },
  ...fields,
});

const question = (
  id: string,
  fields: Pick<Question, "subtaskId"> & Partial<Pick<Question, "text">> & Ask,
): Question => ({
  id,
  from: "glm",
  text: "",
  ...fields,
});

describe("statusText", () => {
  it("tells the goal with its team, meetings and work, and what waits on you", () => {
    const text = statusText({
      members: ["glm", "sonnet"],
      underWay: [],
      meetingsNow: {},
      goal: {
        name: "Dice",
        slug: "dice",
        status: "active",
        createdAt: 0,
        settings: { review: true, meetingSize: "discussion" },
      },
      meetings: [
        {
          id: "m1",
          agenda: "Scoring",
          size: "small",
          participants: ["sonnet"],
          status: "review",
          turns: [],
        },
      ],
      tasks: [{ id: "t1", title: "Game", outcome: "", ownerAccepts: true }],
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
          kind: "permission",
          permission: { tool: "Bash", input: { command: "npm test" }, options: ["once"] },
        }),
        question("q2", {
          subtaskId: "Score",
          text: "Game",
          kind: "decision",
          decision: DECISIONS.delivery(),
        }),
      ],
      tokens: {},
    });
    expect(text)
      .toBe(`Goal "Dice": active, on branch huddle/dice/main; review on, discussion meetings
Team: glm (busy), sonnet
  Meeting [m1], hosted by sonnet: its plan waits for review
  Task "Game" [t1], accepted by the user
    - Rules [Rules], glm: running, step 2 of 3: Write the rolls, waits for an answer
    - Board [Board], sonnet: pending, waits on "Rules" by glm
    - Score [Score], glm: failed, error: API Error: 529

Waiting for answers:
  - [q1] glm asks to use Bash: npm test for "Rules". Allow it? Answered in /huddle.
  - [q2] The task "Game" is done. Accept it? Options: accept, revise.`);
  });
});

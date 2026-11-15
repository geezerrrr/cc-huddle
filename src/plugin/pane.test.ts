import { describe, expect, it } from "vitest";
import type { Work } from "../engine/derive.ts";
import type { Ask, Member, Meeting, Question, Subtask } from "../engine/types.ts";
import { paneTeam } from "./pane.ts";

const role = { id: "dev", title: "Developer", duties: "" };
const members: Member[] = [
  { name: "glm", role, model: "glm-5", env: {} },
  { name: "sonnet", role, env: {} },
];

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

const meeting: Meeting = {
  id: "m1",
  goalId: "g1",
  agenda: "Plan a dice game for two, as the user put it",
  size: "small",
  participants: ["sonnet", "glm"],
  host: "sonnet",
  status: "approved",
  turns: [{ speaker: "sonnet", text: "Two dice.", at: 0, phase: "opening", tokens: 30 }],
  plan: { summary: "A dice game", markdown: "", tasks: [] },
  tokens: 30,
  createdAt: 0,
};

const question = (
  id: string,
  fields: Partial<Pick<Question, "subtaskId" | "from" | "text">> & Ask,
): Question => ({
  id,
  subtaskId: "rules",
  from: "glm",
  text: "",
  status: "open",
  createdAt: 0,
  ...fields,
});

const work = (): Work => ({
  members: ["glm", "sonnet"],
  goals: [{ id: "g1", name: "Dice", slug: "dice", status: "active", createdAt: 0 }],
  tasks: [
    {
      id: "t1",
      goalId: "g1",
      title: "Game",
      outcome: "",
      createdAt: 0,
      meetingId: "m1",
      ownerAccepts: true,
    },
  ],
  meetings: [meeting],
  subtasks: [
    subtask("rules", {
      status: "running",
      startedAt: 1,
      progress: { done: 1, total: 3, current: "Write the reroll" },
      tokens: 100,
    }),
    subtask("board", {
      assignee: "sonnet",
      status: "done",
      startedAt: 1,
      review: { rounds: 1, notes: "Bigger" },
      delivery: { summary: "A grid board.", files: [], at: 1 },
    }),
    subtask("score", { assignee: "sonnet", dependsOn: ["rules"] }),
  ],
  questions: [
    question("q1", {
      kind: "permission",
      permission: {
        tool: "Bash",
        input: { command: "npm test" },
        options: ["once", "always", "deny"],
      },
    }),
    question("q2", {
      text: "Which board?",
      kind: "choices",
      choices: [
        {
          question: "Which board?",
          header: "Board",
          options: [{ label: "Grid", description: "" }],
          multiSelect: false,
        },
      ],
    }),
    question("q3", {
      subtaskId: "board",
      from: "sonnet",
      text: "Game",
      kind: "decision",
      decision: { kind: "delivery", options: ["accept", "revise"] },
    }),
    question("q4", { kind: "teammate", to: "sonnet", text: "Which colour?" }),
  ],
});

describe("paneTeam", () => {
  it("shows what goes on, each member at what they do, and what waits on you", () => {
    const team = paneTeam(work(), members);
    expect(team.band).toBe("1 working · 3 need you");
    expect(team.meeting).toEqual({
      id: "m1",
      about: "Dice",
      agenda: "Plan a dice game for two, as the user put it",
      status: "plan approved",
      participants: ["sonnet", "glm"],
      turns: [{ speaker: "sonnet", text: "Two dice." }],
      hands: [],
      plan: "A dice game",
    });
    expect(team.members).toEqual([
      {
        name: "glm",
        role: "Developer",
        model: "glm-5",
        doing: 'works on "rules", step 2 of 3: Write the reroll',
        subtask: "rules",
        tokens: 100,
      },
      {
        name: "sonnet",
        role: "Developer",
        doing: 'next: "score", waits on "rules" by glm',
        subtask: "board",
        tokens: 30,
      },
    ]);
    expect(team.needs).toEqual([
      {
        id: "q1",
        from: "glm",
        about: "rules",
        text: "",
        kind: "permission",
        call: "Bash: npm test",
        options: ["once", "always", "deny"],
      },
      {
        id: "q2",
        from: "glm",
        about: "rules",
        text: "Which board?",
        kind: "choices",
        choices: [
          { question: "Which board?", header: "Board", options: ["Grid"], multiSelect: false },
        ],
      },
      {
        id: "q3",
        from: "sonnet",
        about: "board",
        text: "Game",
        kind: "decision",
        options: ["accept", "revise"],
        sendBack: [{ id: "board", title: "board" }],
      },
    ]);
    expect(team.milestones).toEqual([
      { key: "plan:m1", text: 'Plan approved: "Dice"' },
      { key: "back:board:1", text: '"board" went back to sonnet: Bigger' },
      { key: "done:board", text: '"board" by sonnet is merged' },
    ]);
    const finished = work();
    finished.subtasks = finished.subtasks.map((s) => ({ ...s, status: "done" as const }));
    expect(paneTeam(finished, members).milestones).toContainEqual({
      key: "task:t1",
      text: 'The task "Game" is done',
    });
    expect(team.prompts).toEqual([
      {
        key: "accept:q3",
        text: `The task "Game" is done [q3], merged into its goal's branch:
- board, by sonnet: A grid board.
Tell the user what was done, and ask whether to accept it or send it back with what to change (decide).`,
      },
    ]);
  });

  it("says who speaks at a meeting under way, a plan to review, and nothing before the first goal", () => {
    const now = work();
    now.meetings = [{ ...meeting, status: "running", speaking: "glm" }];
    now.subtasks = [];
    now.questions = [];
    const team = paneTeam(now, members);
    expect(team.band).toBe("meeting");
    expect(team.meeting?.status).toBe("glm speaks");
    expect(team.members.map((m) => m.doing)).toEqual([
      'at the meeting on "Dice"',
      'at the meeting on "Dice"',
    ]);
    now.meetings = [{ ...meeting, status: "running", drafting: true }];
    expect(paneTeam(now, members).meeting?.status).toBe("the members form their first judgments");
    expect(paneTeam({ ...now, goals: [], meetings: [] }, members).band).toBeUndefined();
    now.meetings = [{ ...meeting, status: "review" }];
    const review = paneTeam(now, members);
    expect(review.band).toBe("plan to review");
    expect(review.prompts).toEqual([
      {
        key: "review:m1",
        text: 'The meeting [m1] on "Dice" has a plan: A dice game. Show it to the user with show_plan, and ask whether to approve it, change it, or cancel it, and which tasks, if any, they want to accept themselves once done: none is unless they say, since reviews and checks confirm the work; it is worth it for a result only looking at it or trying it can judge.',
      },
    ]);
  });
});

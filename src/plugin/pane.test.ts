import { describe, expect, it } from "vitest";
import type { GoalEntry } from "../engine/data.ts";
import type { Work } from "../engine/derive.ts";
import {
  DECISIONS,
  type Ask,
  type Member,
  type Meeting,
  type Question,
  type Subtask,
} from "../engine/types.ts";
import { paneTeam as paneOf, viewEntries, viewLive } from "./pane.ts";

/** The pane for a session running the goal of `work`, with no other goals. */
const paneTeam = (work: Work, team: readonly Member[], others: readonly GoalEntry[] = []) =>
  paneOf({ work, members: team }, others, undefined);

const role = { id: "dev", title: "Developer", duties: "" };
const members: Member[] = [
  { name: "glm", role, model: "glm-5", env: {} },
  { name: "sonnet", role, env: {} },
];

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

const meeting: Meeting = {
  id: "m1",
  agenda: "Plan a dice game for two, as the user put it",
  size: "small",
  participants: ["sonnet", "glm"],
  host: "sonnet",
  status: "approved",
  turns: [{ speaker: "sonnet", text: "Two dice.", at: 0, phase: "opening" }],
  plan: { summary: "A dice game", markdown: "", tasks: [] },
};

const question = (
  id: string,
  fields: Partial<Pick<Question, "subtaskId" | "from" | "text">> & Ask,
): Question => ({
  id,
  subtaskId: "rules",
  from: "glm",
  text: "",
  ...fields,
});

const work = (): Work => ({
  members: ["glm", "sonnet"],
  underWay: [],
  goal: { name: "Dice", slug: "dice", status: "active", createdAt: 0 },
  tasks: [
    {
      id: "t1",
      title: "Game",
      outcome: "",
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
      decision: DECISIONS.delivery(),
    }),
    question("q4", { kind: "teammate", to: "sonnet", text: "Which colour?" }),
  ],
  tokens: { glm: 100, sonnet: 30 },
});

describe("paneTeam", () => {
  it("lists under the band each task not done, with where it stands", () => {
    const now = work();
    const task = (id: string, title: string) => ({
      id,
      title,
      outcome: "",
      ownerAccepts: false,
    });
    now.tasks.push(task("t2", "Score"), task("t3", "Docs"));
    now.subtasks = [
      ...now.subtasks.map((s) => (s.id === "score" ? { ...s, taskId: "t2" } : s)),
      subtask("readme", { taskId: "t3", status: "done" }),
    ];
    expect(paneTeam(now, members).tasks).toEqual([
      "Game · waits for you to accept it",
      'Score · "score" waits on "rules" by glm',
    ]);
    now.questions = now.questions.filter((q) => q.id !== "q3");
    expect(paneTeam(now, members).tasks[0]).toBe(
      'Game · glm works on "rules", step 2 of 3: Write the reroll',
    );

    for (const n of ["5", "6", "7", "8", "9"]) {
      now.tasks.push(task(`t${n}`, `Part ${n}`));
      now.subtasks.push(subtask(`p${n}`, { taskId: `t${n}` }));
    }
    expect(paneTeam(now, members).tasks).toHaveLength(6);
    expect(paneTeam(now, members).tasks.at(-1)).toBe("and 2 more tasks");
    now.goal.status = "archived";
    expect(paneTeam(now, members).tasks).toEqual([]);
  });

  it("shows what goes on, each member at what they do, and what waits on you", () => {
    const team = paneTeam(work(), members);
    expect(team.band).toBe("1 working · 3 need you");
    expect(team.meeting).toEqual({
      about: "Dice",
      agenda: "Plan a dice game for two, as the user put it",
      status: "plan approved",
      host: "sonnet",
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
        headline: 'glm asks to use Bash: npm test for "rules". Allow it?',
        ask: true,
        kind: "options",
        options: [
          { value: "once", label: "Allow once", primary: true },
          { value: "always", label: "Always allow" },
          { value: "deny", label: "Deny" },
        ],
        note: { option: "deny", prompt: "Or deny it, saying why", needed: false },
      },
      {
        id: "q2",
        from: "glm",
        headline: 'glm asks for "rules":',
        ask: true,
        kind: "choices",
        choices: [
          { question: "Which board?", header: "Board", options: ["Grid"], multiSelect: false },
        ],
      },
      {
        id: "q3",
        from: "sonnet",
        headline: 'The task "Game" is done. Accept it?',
        ask: false,
        kind: "options",
        options: [
          { value: "accept", label: "Accept" },
          { value: "revise", label: "Send back" },
        ],
        note: { option: "revise", prompt: "What to change", needed: true },
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

  it("says who speaks at a meeting under way, and a plan to review", () => {
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
    now.meetings = [{ ...meeting, status: "review" }];
    const review = paneTeam(now, members);
    expect(review.band).toBe("plan to review");
    expect(review.prompts).toEqual([
      {
        key: "review:m1",
        text: 'The meeting [m1] on "Dice" has a plan: A dice game. Get it with show_plan and show it to the user in full: its document as it is written, then its tasks, each with its subtasks, who does them and what each waits on. Then ask whether to approve it, change it, or cancel it, and which tasks, if any, they want to accept themselves once done: none is unless they say, since reviews and checks confirm the work; it is worth it for a result only looking at it or trying it can judge.',
      },
    ]);
  });

  it("says where the goal is when nothing goes on, and lists what /openplan resume takes up", () => {
    const now = work();
    now.subtasks = [];
    now.questions = [];
    now.goal.status = "paused";
    const entry = (slug: string, status: "active" | "paused" | "archived", held = false) => ({
      slug,
      state: { ...work(), goal: { ...now.goal, name: slug, slug, status } },
      ...(held && { holder: { pid: 1, session: 7, address: "there" } }),
    });
    const others = [
      entry("chess", "paused"),
      entry("go", "active", true),
      entry("old", "archived"),
    ];
    const team = paneTeam(now, members, others);
    expect(team.band).toBe("paused");
    expect(team.goal).toEqual({ name: "Dice", slug: "dice" });
    expect(team.resumeRefused).toBeUndefined();
    expect(team.resumable).toEqual([
      { slug: "dice", label: "Dice · no plan yet · paused, in this session" },
      { slug: "chess", label: "chess · 1/3 subtasks done · paused" },
      { slug: "go", label: "go · 1/3 subtasks done · in another session" },
      { slug: "old", label: "old · 1/3 subtasks done · archived" },
    ]);
    now.goal.status = "active";
    expect(paneTeam(now, members, others).resumeRefused).toBe(
      '"Dice" is under way in this session, which runs one goal: /openplan pause it first, or take the other up in another session.',
    );
    expect(paneTeam(now, members, others).resumable.map((r) => r.slug)).toEqual([
      "chess",
      "go",
      "old",
    ]);
  });

  it("without a goal, has a band only for goals it can take up, archived ones aside", () => {
    const entry = (slug: string, status: "paused" | "archived", held = false) => ({
      slug,
      state: { ...work(), subtasks: [], goal: { ...work().goal, name: slug, slug, status } },
      ...(held && { holder: { pid: 1, session: 7, address: "there" } }),
    });
    expect(paneOf(undefined, [], undefined)).toEqual({
      noGoal:
        "This session runs no goal. Hand the team a task with /openplan <task>, or take a goal up with /openplan resume.",
      tasks: [],
      members: [],
      needs: [],
      milestones: [],
      prompts: [],
      resumable: [],
    });
    expect(paneOf(undefined, [], "Dice").noGoal).toBe(
      '"Dice" moved to another Claude Code session. Bring it back here with /openplan resume.',
    );
    expect(paneOf(undefined, [entry("old", "archived")], undefined).band).toBeUndefined();
    expect(
      paneOf(
        undefined,
        [entry("a", "paused"), entry("b", "paused"), entry("c", "paused", true)],
        undefined,
      ).band,
    ).toBe("2 goals paused · 1 goal in another session");
  });

  it("words a stuck review and a merge with the note each takes, if any", () => {
    const now = work();
    now.questions = [
      question("q5", {
        text: "Too small",
        kind: "decision",
        decision: DECISIONS.stuckReview(),
      }),
      question("q6", {
        text: "a.png\nb.png",
        kind: "decision",
        decision: DECISIONS.mergeFiles(["a.png", "b.png"]),
      }),
    ];
    const [review, merge] = paneTeam(now, members).needs;
    expect(review).toMatchObject({
      headline: 'The review of "rules" is stuck. What now?',
      detail: "Too small",
      ask: true,
      note: { option: "sendBack", prompt: "Or send it back, saying what to change", needed: false },
    });
    expect(merge).toMatchObject({
      headline: 'Merging "rules" needs you. What now?',
      detail: "a.png, b.png",
      options: [
        { value: "ours", label: "Keep ours" },
        { value: "theirs", label: "Take theirs" },
        { value: "retry", label: "Retry" },
      ],
    });
    expect(merge).not.toHaveProperty("note");
  });
});

describe("viewEntries and viewLive", () => {
  it("name each tool call by its main argument", () => {
    expect(
      viewEntries([
        { at: 0, kind: "text", text: "Done." },
        {
          at: 0,
          kind: "tool",
          name: "Bash",
          input: { command: "npm test", timeout: 5 },
          state: "done",
          output: "ok",
        },
        { at: 0, kind: "tool", name: "TodoWrite", input: {}, state: "error", output: "" },
      ]),
    ).toEqual([
      { at: 0, kind: "text", text: "Done." },
      { at: 0, kind: "tool", name: "Bash", argument: "npm test", state: "done", output: "ok" },
      { at: 0, kind: "tool", name: "TodoWrite", state: "error", output: "" },
    ]);
    expect(
      viewLive({
        starting: "Read",
        running: [
          { kind: "tool", id: "c1", name: "Grep", input: { pattern: "board" }, state: "running" },
        ],
      }),
    ).toEqual({ starting: "Read", running: [{ name: "Grep", argument: "board" }] });
  });
});

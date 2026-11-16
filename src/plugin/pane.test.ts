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
  paneOf({ work, members: team }, others, { moved: undefined, opened: 1 });

/** The pane for a session running no goal, `moved` the one that moved to another session. */
const noGoal = (others: readonly GoalEntry[] = [], moved?: string) =>
  paneOf(undefined, others, { moved, opened: 0 });

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
  status: "approved",
  turns: [{ speaker: "sonnet", text: "Two dice.", phase: "opening" }],
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
  meetingsNow: {},
  goal: {
    name: "Dice",
    slug: "dice",
    status: "active",
    createdAt: 0,
    settings: { review: true, meetingSize: "discussion" },
  },
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
      heading: "Dice · plan approved",
      attendance: "sonnet and glm, hosted by sonnet",
      agenda: "Plan a dice game for two, as the user put it",
      turns: [{ heading: "sonnet", text: "Two dice." }],
      plan: "Plan: A dice game",
    });
    expect(team.members).toEqual([
      {
        name: "glm",
        line: "Developer · glm-5 · 100 tokens",
        doing: 'works on "rules", step 2 of 3: Write the reroll',
        followable: true,
      },
      {
        name: "sonnet",
        line: "Developer · 30 tokens",
        doing: 'next: "score", waits on "rules" by glm',
        followable: true,
      },
    ]);
    expect(team.needs).toEqual([
      {
        id: "q1",
        from: "glm",
        headline: 'glm asks to use Bash: npm test for "rules". Allow it?',
        kind: "options",
        options: [
          { value: "once", label: "Allow once", primary: true },
          { value: "always", label: "Always allow" },
          { value: "deny", label: "Deny" },
        ],
        note: { option: "deny", label: "Deny", prompt: "Or deny it, saying why" },
      },
      {
        id: "q2",
        from: "glm",
        headline: 'glm asks for "rules":',
        kind: "choices",
        choices: [
          {
            question: "Which board?",
            header: "Board",
            options: [{ label: "Grid" }],
            multiSelect: false,
          },
        ],
      },
      {
        id: "q3",
        from: "sonnet",
        headline: 'The task "Game" is done. Accept it?',
        detail: "- board, by sonnet: A grid board.",
        kind: "options",
        options: [{ value: "accept", label: "Accept" }],
        note: { option: "revise", label: "Send back", prompt: "What to change" },
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
    // With more than one done, you pick which a revised task goes back to.
    expect(paneTeam(finished, members).needs.at(-1)).toMatchObject({
      sendBack: [
        { id: "rules", title: "rules" },
        { id: "board", title: "board" },
        { id: "score", title: "score" },
      ],
    });
  });

  it("says who speaks at a meeting under way, and a plan to review", () => {
    const now = work();
    now.meetings = [{ ...meeting, status: "running" }];
    now.meetingsNow = {
      m1: {
        speaking: { member: "glm", planning: false },
        hands: [{ member: "ann", point: "dice" }],
      },
    };
    now.subtasks = [];
    now.questions = [];
    const team = paneTeam(now, members);
    expect(team.band).toBe("meeting");
    expect(team.meeting?.heading).toBe("Dice · glm speaks");
    expect(team.meeting?.hands).toBe("Hands up: ann (dice)");
    expect(team.members.map((m) => m.doing)).toEqual([
      'at the meeting on "Dice"',
      'at the meeting on "Dice"',
    ]);
    now.meetingsNow = { m1: { together: "drafting", hands: [] } };
    expect(paneTeam(now, members).meeting?.heading).toBe(
      "Dice · the members form their first judgments",
    );
    const plan = (ownerAccepts: boolean) => ({
      summary: "A dice game",
      markdown: "# Dice",
      tasks: [
        {
          title: "Rules",
          outcome: "",
          ownerAccepts: false,
          subtasks: [
            {
              key: "r",
              title: "Rules",
              description: "",
              assignee: "glm",
              dependsOn: [],
              acceptance: "",
            },
          ],
        },
        {
          title: "Board",
          outcome: "",
          ownerAccepts,
          subtasks: [
            {
              key: "b",
              title: "Board",
              description: "",
              assignee: "sonnet",
              dependsOn: ["r"],
              acceptance: "",
            },
          ],
        },
      ],
    });
    now.meetings = [{ ...meeting, status: "review", plan: plan(false) }];
    const review = paneTeam(now, members);
    // The plan waits on you, but the band counts it apart from what members ask.
    expect(review.band).toBe("plan to review");
    expect(review.needs[0]?.id).toMatch(/^m1:[0-9a-f]{12}$/);
    expect(review.needs).toMatchObject([
      {
        from: "Plan",
        headline: 'The plan for "Dice" waits for you: A dice game',
        detail: '1. Rules: Rules (glm)\n2. Board: Board (sonnet, after "Rules")',
        kind: "plan",
        meeting: "m1",
        document: "# Dice",
        tasks: ["Rules", "Board"],
      },
    ]);
    // Changed, it is another plan to ask you about, and says which tasks you accept.
    now.meetings = [{ ...meeting, status: "review", plan: plan(true) }];
    const [changed] = paneTeam(now, members).needs;
    expect(changed?.id).not.toBe(review.needs[0]?.id);
    expect(changed?.detail).toContain("2. Board (you accept it): Board");
  });

  it("says where the goal is when nothing goes on, and lists what /huddle resume takes up", () => {
    const now = work();
    now.subtasks = [];
    now.questions = [];
    now.goal.status = "paused";
    const entry = (slug: string, status: "active" | "paused" | "archived", held = false) => ({
      slug,
      state: { ...work(), questions: [], goal: { ...now.goal, name: slug, slug, status } },
      ...(held && { holder: { pid: 1, session: 7, address: "there" } }),
    });
    const others = [
      entry("chess", "paused"),
      entry("go", "active", true),
      entry("old", "archived"),
    ];
    const team = paneTeam(now, members, others);
    expect(team.band).toBe("paused");
    expect(team.resumeRefused).toBeUndefined();
    expect(team.pauseRefused).toBe('"Dice" isn\'t under way: it is paused.');
    expect(team.resumable).toEqual([
      { slug: "dice", label: "Dice · no plan yet · paused, in this session" },
      { slug: "chess", label: "chess · 1/3 subtasks done · paused" },
      { slug: "go", label: "go · 1/3 subtasks done · in another session" },
      { slug: "old", label: "old · 1/3 subtasks done · archived" },
    ]);
    now.goal.status = "active";
    expect(paneTeam(now, members, others).resumeRefused).toBe(
      '"Dice" is under way in this session, which runs one goal: /huddle pause it first, or take the other up in another session.',
    );
    expect(paneTeam(now, members, others).pauseRefused).toBeUndefined();
    expect(paneTeam(now, members, others).resumable.map((r) => r.slug)).toEqual([
      "chess",
      "go",
      "old",
    ]);
  });

  it("without a goal, has a band only for goals it can take up, archived ones aside", () => {
    const entry = (slug: string, status: "paused" | "archived", held = false) => ({
      slug,
      state: {
        ...work(),
        questions: [],
        subtasks: [],
        goal: { ...work().goal, name: slug, slug, status },
      },
      ...(held && { holder: { pid: 1, session: 7, address: "there" } }),
    });
    const none =
      "This session runs no goal. Hand the team a task with /huddle <task>, or take a goal up with /huddle resume.";
    expect(noGoal()).toEqual({
      noGoal: none,
      opened: 0,
      tasks: [],
      members: [],
      needs: [],
      milestones: [],
      resumable: [],
      resumeRefused: "No goal to resume.",
      pauseRefused: none,
    });
    expect(noGoal([], "Dice").noGoal).toBe(
      '"Dice" moved to another Claude Code session. Bring it back here with /huddle resume.',
    );
    expect(noGoal([entry("old", "archived")]).band).toBeUndefined();
    expect(
      noGoal([entry("a", "paused"), entry("b", "paused"), entry("c", "paused", true)]).band,
    ).toBe("2 goals paused · 1 goal in another session");
  });

  it("words a stuck review and a merge with the note each takes, if any", () => {
    const now = work();
    now.questions = [
      question("q5", {
        text: "Too small",
        kind: "decision",
        decision: DECISIONS.stuckReview(),
        subtaskId: "rules",
      }),
      question("q6", {
        text: "a.png\nb.png",
        kind: "decision",
        decision: DECISIONS.mergeFiles(["a.png", "b.png"]),
        subtaskId: "rules",
      }),
    ];
    const [review, merge] = paneTeam(now, members).needs;
    expect(review).toMatchObject({
      headline: 'The review of "rules" is stuck. What now?',
      detail: "Too small",
      note: {
        option: "sendBack",
        label: "Send back",
        prompt: "Or send it back, saying what to change",
      },
    });
    expect(merge).toMatchObject({
      headline: 'Merging "rules" is stuck. What now?',
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
        { kind: "text", text: "Done." },
        {
          kind: "tool",
          name: "Bash",
          input: { command: "npm test", timeout: 5 },
          state: "done",
          output: "ok",
        },
        { kind: "tool", name: "TodoWrite", input: {}, state: "error", output: "" },
      ]),
    ).toEqual([
      { kind: "text", text: "Done." },
      { kind: "tool", name: "Bash", argument: "npm test", state: "done", output: "ok" },
      { kind: "tool", name: "TodoWrite", state: "error", output: "" },
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

import { describe, expect, it } from "vitest";
import {
  busyMembers,
  derive,
  meetingResumes,
  over,
  reviewerOf,
  waitsIn,
  type Work,
} from "./derive.ts";
import { DECISIONS, type Ask, type Meeting, type Question, type Subtask } from "./types.ts";

const subtask = (id: string, fields: Partial<Subtask> = {}): Subtask => ({
  id,
  taskId: "t1",
  title: id,
  description: "",
  acceptance: "",
  assignee: "ann",
  dependsOn: [],
  status: "pending",
  progress: { done: 0, total: 0 },
  ...fields,
});

const meeting = (fields: Partial<Meeting> = {}): Meeting => ({
  id: "m1",
  agenda: "",
  size: "discussion",
  participants: ["host", "ann"],
  status: "approved",
  turns: [],
  ...fields,
});

const question = (fields: Pick<Question, "id" | "subtaskId"> & Ask): Question => ({
  from: "ann",
  text: "",
  ...fields,
});

const work = (fields: Partial<Work> = {}): Work => ({
  members: ["host", "ann", "bob"],
  underWay: [],
  meetingsNow: {},
  goal: {
    name: "dice",
    slug: "dice",
    status: "active",
    createdAt: 0,
    settings: { review: true, meetingSize: "discussion", parallel: false },
  },
  tasks: [
    {
      id: "t1",
      title: "",
      outcome: "",
      meetingId: "m1",
      ownerAccepts: true,
    },
  ],
  subtasks: [],
  meetings: [meeting()],
  questions: [],
  tokens: {},
  ...fields,
});

describe("reviewerOf", () => {
  it("is the meeting's host", () => {
    expect(reviewerOf(work(), subtask("s1"))).toBe("host");
  });

  it("is another member when the host is the assignee or there was no meeting", () => {
    expect(reviewerOf(work(), subtask("s1", { assignee: "host" }))).toBe("ann");
    const direct = work({
      tasks: [{ id: "t1", title: "", outcome: "", ownerAccepts: true }],
    });
    expect(reviewerOf(direct, subtask("s1"))).toBe("host");
  });

  it("is the assignee when nobody else is on the team", () => {
    expect(reviewerOf(work({ members: ["ann"], meetings: [] }), subtask("s1"))).toBe("ann");
  });
});

describe("waitsIn", () => {
  it("waits on an upstream not merged, marking a halted one", () => {
    const up = subtask("up", { assignee: "bob", status: "failed" });
    const down = subtask("down", { dependsOn: ["up"] });
    const state = work({ subtasks: [up, down] });
    expect(waitsIn(state, down, busyMembers(state))).toEqual([
      { kind: "upstream", by: "bob", subtaskId: "up", halted: true },
    ]);
  });

  it("waits on its busy assignee once upstream is merged", () => {
    const up = subtask("up", { assignee: "bob", status: "done" });
    const other = subtask("other", { status: "running" });
    const down = subtask("down", { dependsOn: ["up"] });
    const state = work({ subtasks: [up, other, down] });
    expect(waitsIn(state, down, busyMembers(state))).toEqual([{ kind: "busy", by: "ann" }]);
  });

  it("has new work wait for its member's work going on in its session, while that can start", () => {
    const fresh = subtask("fresh");
    const told = subtask("told");
    const held = subtask("held", { session: "glm-1", goOn: [{ why: "held" }] });
    const state = work({ subtasks: [fresh, told, held] });
    expect(waitsIn(state, fresh, busyMembers(state))).toEqual([
      { kind: "after", subtaskId: "held" },
    ]);
    expect(waitsIn(state, held, busyMembers(state))).toEqual([]);
    held.dependsOn = ["up"];
    state.subtasks.push(subtask("up", { assignee: "bob" }));
    expect(waitsIn(state, fresh, busyMembers(state))).toEqual([]);
  });

  it("has a member's new work that could start wait for the first of it", () => {
    const first = subtask("first");
    const second = subtask("second");
    const state = work({ subtasks: [first, second] });
    expect(waitsIn(state, first, busyMembers(state))).toEqual([]);
    expect(waitsIn(state, second, busyMembers(state))).toEqual([
      { kind: "after", subtaskId: "first" },
    ]);
  });

  it("waits on the acceptance of another task you accept before building on it", () => {
    const task = (ownerAccepts: boolean) => ({
      id: "t0",
      title: "",
      outcome: "",
      ownerAccepts,
    });
    const up = subtask("up", { taskId: "t0", status: "done" });
    const rest = subtask("rest", { taskId: "t0", assignee: "ann" });
    const down = subtask("down", { dependsOn: ["up"], assignee: "bob" });
    const accept = question({
      id: "q1",
      subtaskId: "up",
      kind: "decision",
      decision: DECISIONS.delivery(),
    });
    const accepted = work({ tasks: [task(true)], subtasks: [up, down], questions: [accept] });
    expect(waitsIn(accepted, down, busyMembers(accepted))).toEqual([
      { kind: "acceptance", questionId: "q1" },
    ]);
    // The rest of a task you accept is waited for first; of any other, only what it uses.
    const unfinished = (ownerAccepts: boolean) =>
      work({ tasks: [task(ownerAccepts)], subtasks: [up, rest, down] });
    expect(waitsIn(unfinished(true), down, new Set())).toEqual([
      { kind: "upstream", by: "ann", subtaskId: "rest", halted: false },
    ]);
    expect(waitsIn(unfinished(false), down, new Set())).toEqual([]);
  });

  it("holds what is pending or yet to merge while its goal is paused", () => {
    const state = work({
      goal: {
        name: "dice",
        slug: "dice",
        status: "paused",
        createdAt: 0,
        settings: { review: true, meetingSize: "discussion", parallel: false },
      },
    });
    const held = [{ kind: "goal", status: "paused" }];
    expect(waitsIn(state, subtask("s1"), new Set())).toEqual(held);
    expect(waitsIn(state, subtask("s1", { status: "merging" }), new Set())).toEqual(held);
  });

  it("waits for a reviewer who is reviewing earlier work", () => {
    const first = subtask("first", {
      status: "reviewing",
      assignee: "bob",
      delivery: { summary: "", files: [], at: 1 },
    });
    const second = subtask("second", {
      status: "reviewing",
      delivery: { summary: "", files: [], at: 2 },
    });
    const state = work({ subtasks: [first, second] });
    expect(waitsIn(state, first, busyMembers(state))).toEqual([]);
    expect(waitsIn(state, second, busyMembers(state))).toEqual([{ kind: "busy", by: "host" }]);
  });

  it("has a review or merge under way go first, then the rest in delivery order, one at a time", () => {
    const at = (n: number) => ({ summary: "", files: [], at: n });
    const early = subtask("early", { status: "reviewing", assignee: "bob", delivery: at(1) });
    const late = subtask("late", { status: "reviewing", delivery: at(2) });
    const reviewing = work({ subtasks: [early, late], underWay: ["late"] });
    expect(waitsIn(reviewing, late, busyMembers(reviewing))).toEqual([]);
    expect(waitsIn(reviewing, early, busyMembers(reviewing))).toEqual([
      { kind: "busy", by: "host" },
    ]);

    const first = subtask("first", { status: "merging", delivery: at(1) });
    const next = subtask("next", { status: "merging", delivery: at(2) });
    const queued = work({ subtasks: [first, next] });
    expect(waitsIn(queued, first, new Set())).toEqual([]);
    expect(waitsIn(queued, next, new Set())).toEqual([{ kind: "merge", subtaskId: "first" }]);
    const merging = work({ subtasks: [first, next], underWay: ["next"] });
    expect(waitsIn(merging, first, new Set())).toEqual([{ kind: "merge", subtaskId: "next" }]);
    // One that waits on your decision holds no merge up.
    const deciding = work({ subtasks: [{ ...first, status: "waitingInMerge" }, next] });
    expect(waitsIn(deciding, next, new Set())).toEqual([]);
  });

  it("waits on a teammate's answer and on yours while running", () => {
    const running = subtask("s1", { status: "running" });
    const state = work({
      subtasks: [running],
      questions: [
        question({ id: "q1", subtaskId: "s1", kind: "teammate", to: "bob" }),
        question({ id: "q2", subtaskId: "s1", kind: "choices", choices: [] }),
      ],
    });
    expect(waitsIn(state, running, busyMembers(state))).toEqual([
      { kind: "teammate", by: "bob", questionId: "q1" },
      { kind: "you", questionId: "q2" },
    ]);
  });
});

describe("over", () => {
  it("holds once every task is done and accepted, or the plan dropped, and no meeting can go on", () => {
    expect(over(work({ tasks: [] }))).toBe(false);
    expect(over(work({ tasks: [], meetings: [meeting({ status: "dropped" })] }))).toBe(true);
    expect(over(work({ tasks: [], meetings: [meeting({ status: "failed" })] }))).toBe(false);
    const done = subtask("s1", { status: "done" });
    expect(over(work({ subtasks: [done] }))).toBe(true);
    expect(over(work({ subtasks: [done, subtask("s2")] }))).toBe(false);
  });
});

describe("derive", () => {
  it("counts everyone in a running meeting as busy", () => {
    const state = work({ meetings: [meeting({ status: "running" })] });
    expect(derive(state).busy.sort()).toEqual(["ann", "host"]);
  });
});

describe("meetingResumes", () => {
  it("lets a meeting stopped before its plan go on, and not one whose plan was dropped", () => {
    expect(meetingResumes(work(), meeting({ status: "failed" }))).toBe(true);
    expect(meetingResumes(work(), meeting({ status: "cancelled" }))).toBe(true);
    const dropped = meeting({
      status: "dropped",
      plan: { summary: "", markdown: "", tasks: [] },
    });
    expect(meetingResumes(work(), dropped)).toBe(false);
  });
});

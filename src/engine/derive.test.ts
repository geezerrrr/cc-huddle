import { describe, expect, it } from "vitest";
import { busyMembers, derive, meetingResumes, reviewerOf, waitsIn, type Work } from "./derive.ts";
import type { Meeting, Question, Subtask } from "./types.ts";

const subtask = (id: string, fields: Partial<Subtask> = {}): Subtask => ({
  id,
  taskId: "t1",
  goalId: "p1",
  title: id,
  description: "",
  acceptance: "",
  assignee: "ann",
  dependsOn: [],
  status: "pending",
  createdAt: 0,
  progress: { done: 0, total: 0 },
  tokens: 0,
  ...fields,
});

const meeting = (fields: Partial<Meeting> = {}): Meeting => ({
  id: "m1",
  goalId: "p1",
  agenda: "",
  size: "discussion",
  participants: ["host", "ann"],
  host: "host",
  status: "approved",
  turns: [],
  tokens: 0,
  createdAt: 0,
  ...fields,
});

const question = (fields: Partial<Question> & Pick<Question, "id">): Question => ({
  from: "ann",
  to: "you",
  text: "",
  options: [],
  status: "open",
  createdAt: 0,
  ...fields,
});

const work = (fields: Partial<Work> = {}): Work => ({
  members: ["host", "ann", "bob"],
  goals: [{ id: "p1", name: "dice", branch: "openplan/dice", status: "active", createdAt: 0 }],
  tasks: [{ id: "t1", goalId: "p1", title: "", outcome: "", createdAt: 0, meetingId: "m1" }],
  subtasks: [],
  meetings: [meeting()],
  questions: [],
  ...fields,
});

describe("reviewerOf", () => {
  it("is the meeting's host", () => {
    expect(reviewerOf(work(), subtask("s1"))).toBe("host");
  });

  it("is another member when the host is the assignee or there was no meeting", () => {
    expect(reviewerOf(work(), subtask("s1", { assignee: "host" }))).toBe("ann");
    const direct = work({
      tasks: [{ id: "t1", goalId: "p1", title: "", outcome: "", createdAt: 0 }],
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

  it("waits on another task's acceptance before building on it", () => {
    const up = subtask("up", { taskId: "t0", status: "done" });
    const down = subtask("down", { dependsOn: ["up"], assignee: "bob" });
    const accept = question({
      id: "q1",
      subtaskId: "up",
      decision: { kind: "delivery", options: ["accept", "revise"] },
    });
    const state = work({ subtasks: [up, down], questions: [accept] });
    expect(waitsIn(state, down, busyMembers(state))).toEqual([
      { kind: "acceptance", questionId: "q1" },
    ]);
  });

  it("holds everything pending while its goal is paused", () => {
    const state = work({
      goals: [{ id: "p1", name: "dice", branch: "b", status: "paused", createdAt: 0 }],
    });
    expect(waitsIn(state, subtask("s1"), new Set())).toEqual([{ kind: "goal", status: "paused" }]);
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

  it("waits on a teammate's answer and on yours while running", () => {
    const running = subtask("s1", { status: "running" });
    const state = work({
      subtasks: [running],
      questions: [
        question({ id: "q1", subtaskId: "s1", to: "bob" }),
        question({ id: "q2", subtaskId: "s1" }),
      ],
    });
    expect(waitsIn(state, running, busyMembers(state))).toEqual([
      { kind: "teammate", by: "bob", questionId: "q1" },
      { kind: "you", questionId: "q2" },
    ]);
  });
});

describe("derive", () => {
  it("offers redo only once an upstream was done again after it started", () => {
    const up = subtask("up", { status: "done", finishedAt: 5 });
    const down = subtask("down", { status: "done", dependsOn: ["up"], startedAt: 3 });
    const view = derive(work({ subtasks: [up, down] }));
    expect(view.subtasks.down).toEqual({ waits: [], actions: ["redo"], redone: ["up"] });
    expect(view.subtasks.up?.actions).toEqual([]);
  });

  it("offers stopping a merge only while it waits on your call", () => {
    const merging = subtask("s1", { status: "merging" });
    expect(derive(work({ subtasks: [merging] })).subtasks.s1?.actions).toEqual([]);
    const deciding = work({
      subtasks: [merging],
      questions: [
        question({ id: "q1", subtaskId: "s1", decision: { kind: "merge", options: ["retry"] } }),
      ],
    });
    expect(derive(deciding).subtasks.s1?.actions).toEqual(["stop"]);
  });

  it("offers delete only for an archived goal", () => {
    const state = work({
      goals: [{ id: "p1", name: "dice", branch: "b", status: "archived", createdAt: 0 }],
    });
    expect(derive(state).goals.p1).toEqual(["resume", "delete"]);
  });

  it("counts everyone in a running meeting as busy", () => {
    const state = work({ meetings: [meeting({ status: "running" })] });
    expect(derive(state).busy.sort()).toEqual(["ann", "host"]);
  });
});

describe("meetingResumes", () => {
  it("lets a stopped meeting go on until its plan is out", () => {
    expect(meetingResumes(work(), meeting({ status: "failed" }))).toBe(true);
    const planned = meeting({
      status: "cancelled",
      plan: { summary: "", markdown: "", tasks: [] },
    });
    expect(meetingResumes(work(), planned)).toBe(false);
  });

  it("not once a participant has left the team", () => {
    expect(meetingResumes(work({ members: ["ann"] }), meeting({ status: "failed" }))).toBe(false);
  });
});

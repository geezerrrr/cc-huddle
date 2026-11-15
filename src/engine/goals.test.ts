import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Core } from "./core.ts";
import {
  deskFolder,
  git,
  goalBranch,
  goalFolder,
  openDesk,
  openGoal,
  openRepository,
  subtaskBranch,
} from "./git.ts";
import { Goals } from "./goals.ts";
import type { Meetings } from "./meetings.ts";
import type { Scheduler } from "./scheduler.ts";
import type { Meeting, Member } from "./types.ts";

const ME = {
  GIT_AUTHOR_NAME: "you",
  GIT_AUTHOR_EMAIL: "you@example.com",
  GIT_COMMITTER_NAME: "you",
  GIT_COMMITTER_EMAIL: "you@example.com",
};

const member = (name: string): Member => ({
  name,
  role: { id: "dev", title: "Developer", duties: "" },
  env: {},
});

const meeting = (id: string, status: Meeting["status"]): Meeting => ({
  id,
  agenda: "",
  size: "small",
  participants: ["glm"],
  host: "glm",
  status,
  turns: [],
  tokens: 0,
  createdAt: 0,
});

let dir: string;
let core: Core;
let goals: Goals;
const scheduler = {
  hold: vi.fn(),
  pump: vi.fn(),
  release: vi.fn(() => Promise.resolve()),
  assign: vi.fn(() => []),
};
const meetings = {
  cancel: vi.fn(),
  resume: vi.fn(),
  settled: vi.fn(() => Promise.resolve()),
};

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-goals-")));
  const repo = path.join(dir, "repo");
  await git({ cwd: dir }, ["init", "-q", "--initial-branch=main", repo]);
  await writeFile(path.join(repo, "README.md"), "hello\n");
  await git({ cwd: repo, env: ME }, ["add", "-A"]);
  await git({ cwd: repo, env: ME }, ["commit", "-q", "-m", "start"]);
  core = {
    state: {
      goal: { id: "g1", name: "Dice", slug: "dice", status: "active", createdAt: 0 },
      tasks: [],
      subtasks: [],
      meetings: [],
      questions: [],
    },
    team: { members: [member("glm")], review: false },
    places: { repo: await openRepository(repo), root: path.join(dir, "data") },
    changed: vi.fn(),
    allowAlways: vi.fn(),
    options: () => ({}),
    recorder: () => ({}),
    speech: () => ({}),
    underWay: () => [],
  };
  goals = new Goals(core, scheduler as unknown as Scheduler, meetings as unknown as Meetings);
  vi.clearAllMocks();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );
const branches = async () =>
  (
    await git({ cwd: core.places.repo.top }, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads/",
    ])
  ).stdout
    .split("\n")
    .filter(Boolean);

describe("Goals", () => {
  it("pause and archive, holding their work and cancelling their meetings, and resume", async () => {
    const { goal } = core.state;
    core.state.meetings.push(meeting("m1", "running"), meeting("m2", "review"));
    await goals.pause();
    await goals.pause();
    expect(goal.status).toBe("paused");
    expect(scheduler.hold).toHaveBeenCalledTimes(1);
    expect(meetings.cancel.mock.calls).toEqual([["m1"]]);

    await goals.archive();
    expect(goal).toMatchObject({ status: "archived", archivedAt: expect.any(Number) as number });
    expect(meetings.cancel).toHaveBeenLastCalledWith("m2");
    await expect(goals.pause()).rejects.toThrow("archived: resume it first");

    await goals.resume();
    expect(goal).toMatchObject({ status: "active", archivedAt: undefined });
    expect(scheduler.pump).toHaveBeenCalled();
  });

  it("resume the meetings a session stopped as it let the goal go, before other work", async () => {
    await goals.pause();
    await goals.resume(["m1"]);
    expect(meetings.resume).toHaveBeenCalledWith("m1");
    expect(meetings.resume.mock.invocationCallOrder[0]).toBeLessThan(
      scheduler.pump.mock.invocationCallOrder[0] ?? 0,
    );
    await goals.resume(["m2"]);
    expect(meetings.resume).toHaveBeenCalledTimes(1);
  });

  it("are deleted once archived: worktrees and subtask branches go, the goal's branch stays", async () => {
    await openGoal(core.places, "dice");
    await openDesk(core.places, "dice", "s1");
    expect(await branches()).toContain(subtaskBranch("dice", "s1"));
    core.state.subtasks.push({
      id: "s1",
      taskId: "t1",
      title: "",
      description: "",
      acceptance: "",
      assignee: "glm",
      dependsOn: [],
      status: "stopped",
      createdAt: 0,
      progress: { done: 0, total: 0 },
      tokens: 0,
    });

    await expect(goals.delete()).rejects.toThrow("isn't archived");
    await goals.archive();
    await goals.delete();
    expect(scheduler.release).toHaveBeenCalledWith(["s1"]);
    expect(meetings.settled).toHaveBeenCalled();
    expect(await branches()).toEqual(["main", goalBranch("dice")]);
    expect(await exists(deskFolder(core.places, "s1"))).toBe(false);
    expect(await exists(goalFolder(core.places))).toBe(false);
  });

  it("take a subtask directly, as a task of its own, for a member on the team", async () => {
    const work = { title: "Scoreboard", description: "Top right", acceptance: "", assignee: "glm" };
    expect(() => goals.assign({ ...work, assignee: "ann" })).toThrow(
      'There is no member called "ann"',
    );
    goals.assign(work);
    expect(scheduler.assign).toHaveBeenCalledWith([
      {
        title: "Scoreboard",
        outcome: "",
        ownerAccepts: false,
        subtasks: [{ ...work, key: "", dependsOn: [] }],
      },
    ]);
    await goals.archive();
    expect(() => goals.assign(work)).toThrow("archived: resume it first");
  });
});

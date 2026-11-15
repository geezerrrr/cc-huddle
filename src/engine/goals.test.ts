import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
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
  openRepository,
  subtaskBranch,
} from "./git.ts";
import { Goals } from "./goals.ts";
import type { Meetings } from "./meetings.ts";
import { recordFile } from "./records.ts";
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

const meeting = (id: string, status: Meeting["status"], planFile?: string): Meeting => ({
  id,
  goalId: "",
  agenda: "",
  size: "small",
  participants: ["glm"],
  host: "glm",
  status,
  turns: [],
  tokens: 0,
  createdAt: 0,
  ...(planFile !== undefined && { planFile }),
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
const meetings = { cancel: vi.fn(), settled: vi.fn(() => Promise.resolve()) };

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-goals-")));
  const repo = path.join(dir, "repo");
  await git({ cwd: dir }, ["init", "-q", "--initial-branch=main", repo]);
  await writeFile(path.join(repo, "README.md"), "hello\n");
  await git({ cwd: repo, env: ME }, ["add", "-A"]);
  await git({ cwd: repo, env: ME }, ["commit", "-q", "-m", "start"]);
  core = {
    state: { goals: [], tasks: [], subtasks: [], meetings: [], questions: [] },
    team: { members: [member("glm")], review: false },
    places: { repo: await openRepository(repo), root: path.join(dir, "data") },
    changed: vi.fn(),
    allowAlways: vi.fn(),
    options: () => ({}),
    recorder: () => ({}),
    speech: () => ({}),
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
  it("start on a branch and worktree of their own, a name taken getting the next slug", async () => {
    const [first, second] = await Promise.all([goals.start("Dice game"), goals.start("Dice game")]);
    expect([first.slug, second.slug]).toEqual(["dice-game", "dice-game-2"]);
    expect(first).toMatchObject({ name: "Dice game", status: "active" });
    expect(new Set(await branches())).toEqual(
      new Set(["main", goalBranch("dice-game"), goalBranch("dice-game-2")]),
    );
    expect(
      await readFile(path.join(goalFolder(core.places, "dice-game"), "README.md"), "utf8"),
    ).toBe("hello\n");
  });

  it("pause and archive, holding their work and cancelling their meetings, and resume", async () => {
    const goal = await goals.start("Dice");
    core.state.meetings.push(
      { ...meeting("m1", "running"), goalId: goal.id },
      { ...meeting("m2", "review"), goalId: goal.id },
    );
    await goals.pause(goal.id);
    await goals.pause(goal.id);
    expect(goal.status).toBe("paused");
    expect(scheduler.hold).toHaveBeenCalledTimes(1);
    expect(meetings.cancel.mock.calls).toEqual([["m1"]]);

    await goals.archive(goal.id);
    expect(goal).toMatchObject({ status: "archived", archivedAt: expect.any(Number) as number });
    expect(meetings.cancel).toHaveBeenLastCalledWith("m2");
    await expect(goals.pause(goal.id)).rejects.toThrow("archived: resume it first");

    await goals.resume(goal.id);
    expect(goal).toMatchObject({ status: "active", archivedAt: undefined });
    expect(scheduler.pump).toHaveBeenCalled();
  });

  it("are deleted once archived: worktrees, subtask branches, records and plans go, the goal's branch stays", async () => {
    const goal = await goals.start("Dice");
    await openDesk(core.places, goal.slug, "s1");
    expect(await branches()).toContain(subtaskBranch("dice", "s1"));
    const plans = path.join(core.places.root, "plans");
    await mkdir(plans);
    const planFile = path.join(plans, "dice-m1.md");
    await writeFile(planFile, "# Plan");
    const record = recordFile(core.places, "s1");
    await mkdir(path.dirname(record));
    await writeFile(record, "");
    const { state } = core;
    state.tasks.push({
      id: "t1",
      goalId: goal.id,
      title: "",
      outcome: "",
      createdAt: 0,
      ownerAccepts: true,
    });
    state.subtasks.push({
      id: "s1",
      taskId: "t1",
      goalId: goal.id,
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
    state.meetings.push({ ...meeting("m1", "approved", planFile), goalId: goal.id });
    state.questions.push({
      id: "q1",
      subtaskId: "s1",
      from: "glm",
      text: "",
      status: "open",
      createdAt: 0,
      kind: "choices",
      choices: [],
    });

    await expect(goals.delete(goal.id)).rejects.toThrow("isn't archived");
    await goals.archive(goal.id);
    await goals.delete(goal.id);
    expect(scheduler.release).toHaveBeenCalledWith(["s1"]);
    expect(state).toEqual({ goals: [], tasks: [], subtasks: [], meetings: [], questions: [] });
    expect(await branches()).toEqual(["main", goalBranch("dice")]);
    expect(await exists(deskFolder(core.places, "s1"))).toBe(false);
    expect(await exists(goalFolder(core.places, "dice"))).toBe(false);
    expect(await exists(planFile)).toBe(false);
    expect(await exists(record)).toBe(false);
    await goals.delete(goal.id);
  });

  it("take a subtask directly, as a task of its own, for a member on the team", async () => {
    const goal = await goals.start("Dice");
    const work = { title: "Scoreboard", description: "Top right", acceptance: "", assignee: "glm" };
    expect(() => goals.assign(goal.id, { ...work, assignee: "ann" })).toThrow(
      'There is no member called "ann"',
    );
    goals.assign(goal.id, work);
    expect(scheduler.assign).toHaveBeenCalledWith(goal.id, [
      {
        title: "Scoreboard",
        outcome: "",
        ownerAccepts: false,
        subtasks: [{ ...work, key: "", dependsOn: [] }],
      },
    ]);
    await goals.archive(goal.id);
    expect(() => goals.assign(goal.id, work)).toThrow("archived: resume it first");
  });
});

import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Core } from "./core.ts";
import {
  commitDesk,
  git,
  goalBranch,
  mergeDesk,
  openDesk,
  openGoal,
  openRepository,
  subtaskBranch,
} from "./git.ts";
import { Goals } from "./goals.ts";
import type { Meetings } from "./meetings.ts";
import { Questions } from "./questions.ts";
import type { Scheduler } from "./scheduler.ts";
import {
  DECISIONS,
  type DecisionQuestion,
  type Meeting,
  type Member,
  type Subtask,
} from "./types.ts";
import { goalFiles } from "../shared/layout.ts";

/** What the member merging the goal's base in does in the goal's worktree, in place of a model's turn. */
const resolving: { run: (checkout: string, signal: AbortSignal) => Promise<void> } = vi.hoisted(
  () => ({ run: () => Promise.resolve() }),
);

vi.mock("./turns.ts", () => ({
  turnDecoder: () => () => undefined,
  runTurn: async (_prompt: string, _options: unknown, signal: AbortSignal) => {
    await resolving.run(goalFiles(core.places.root).checkout, signal);
    return { ok: true, text: "", tokens: 7 };
  },
}));

const ME = {
  GIT_AUTHOR_NAME: "you",
  GIT_AUTHOR_EMAIL: "you@example.com",
  GIT_COMMITTER_NAME: "you",
  GIT_COMMITTER_EMAIL: "you@example.com",
};

const member = (name: string): Member => ({
  name,
  role: { title: "Developer", duties: "" },
  env: {},
});

const meeting = (id: string, status: Meeting["status"]): Meeting => ({
  id,
  agenda: "",
  size: "small",
  participants: ["glm"],
  status,
  turns: [],
});

let dir: string;
let core: Core;
let goals: Goals;
let questions: Questions;
const scheduler = {
  hold: vi.fn(),
  pump: vi.fn(),
  release: vi.fn(() => Promise.resolve()),
  decide: vi.fn(() => Promise.resolve()),
  assign: vi.fn(() => []),
};
const meetings = {
  cancel: vi.fn(),
  resume: vi.fn(),
  settled: vi.fn(() => Promise.resolve()),
};

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "huddle-goals-")));
  const repo = path.join(dir, "repo");
  await git({ cwd: dir }, ["init", "-q", "--initial-branch=main", repo]);
  await writeFile(path.join(repo, "README.md"), "hello\n");
  await git({ cwd: repo, env: ME }, ["add", "-A"]);
  await git({ cwd: repo, env: ME }, ["commit", "-q", "-m", "start"]);
  core = {
    state: {
      goal: {
        name: "Dice",
        slug: "dice",
        status: "active",
        createdAt: 0,
        settings: { review: false, meetingSize: "discussion", parallel: false },
        base: "main",
      },
      tasks: [],
      subtasks: [],
      meetings: [],
      questions: [],
      tokens: {},
    },
    team: { members: [member("glm")] },
    places: { repo: await openRepository(repo), slug: "dice", root: path.join(dir, "data") },
    changed: vi.fn(),
    allowAlways: vi.fn(),
    options: () => ({ settings: "glm.json" }),
    recorder: () => ({}),
    speech: () => ({}),
    underWay: () => [],
    meetingsNow: () => ({}),
    questionsNow: () => [],
    handingBack: () => undefined,
  };
  questions = new Questions(core);
  goals = new Goals(
    core,
    scheduler as unknown as Scheduler,
    meetings as unknown as Meetings,
    questions,
  );
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
    expect(goal.status).toBe("archived");
    expect(meetings.cancel).toHaveBeenLastCalledWith("m2");
    await expect(goals.pause()).rejects.toThrow("archived: resume it first");

    await goals.resume();
    expect(goal.status).toBe("active");
    expect(scheduler.pump).toHaveBeenCalled();
  });

  it("close once their plan is dropped, ask to clean up, and then only delete", async () => {
    const { goal } = core.state;
    core.state.meetings.push(meeting("m1", "review"));
    goals.settle();
    expect(goal.status).toBe("active");
    core.state.meetings[0] = meeting("m1", "dropped");
    goals.settle();
    expect(goal.status).toBe("closed");
    expect(core.state.questions).toMatchObject([{ from: "glm", decision: { kind: "cleanUp" } }]);
    await expect(goals.pause()).rejects.toThrow("is closed: nothing in it can go on");
    await expect(goals.archive()).rejects.toThrow("is closed");
    await expect(goals.resume()).rejects.toThrow("is closed");
    await goals.delete();
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
    await openGoal(core.places);
    await openDesk(core.places, "s1");
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
      progress: { done: 0, total: 0 },
    });

    await expect(goals.delete()).rejects.toThrow("isn't archived");
    await goals.archive();
    await goals.delete();
    expect(scheduler.release).toHaveBeenCalledWith(["s1"]);
    expect(meetings.settled).toHaveBeenCalled();
    expect(await branches()).toEqual([goalBranch("dice"), "main"]);
    expect(await exists(goalFiles(core.places.root).desk("s1"))).toBe(false);
    expect(await exists(goalFiles(core.places.root).checkout)).toBe(false);
  });

  it("hand their work back once it is done, on your word, and close", async () => {
    const { goal } = core.state;
    await doneWork(false);
    goals.settle();
    const asked = await opened("handBack");
    expect(asked.from).toBe("glm");

    await goals.decide(asked, { kind: "decision", option: "notNow" });
    expect(goal.status).toBe("paused");
    expect(core.state.questions).toEqual([]);

    await goals.resume();
    goals.settle();
    const again = await opened("handBack");
    await goals.decide(again, { kind: "decision", option: "merge" });
    const cleanUp = await opened("cleanUp");
    expect(goal.status).toBe("closed");
    const merged = await git({ cwd: core.places.repo.top }, ["show", "main:dice.ts"]);
    expect(merged.stdout).toBe("roll\n");

    await goals.decide(cleanUp, { kind: "decision", option: "keep" });
    expect(core.state.questions).toEqual([]);
  });

  it("close with nothing to ask where there is no work to hand back", async () => {
    const { goal } = core.state;
    await doneWork(false, false);
    goals.settle();
    await opened("cleanUp");
    expect(goal.status).toBe("closed");
  });

  it("have the lead merge in what your branch gained meanwhile, then close", async () => {
    await conflicting();
    resolving.run = async (checkout) => {
      await git({ cwd: checkout, env: ME }, ["merge", "-q", "main"], { allow: [1] });
      await writeFile(path.join(checkout, "README.md"), "roll and mine\n");
      await git({ cwd: checkout, env: ME }, ["commit", "-q", "-am", "Merge main"]);
    };
    await goals.decide(await opened("handBack"), { kind: "decision", option: "merge" });
    await opened("cleanUp");
    expect(core.state.goal.status).toBe("closed");
    expect(core.state.tokens).toEqual({ glm: 7 });
    expect(await readFile(path.join(core.places.repo.top, "README.md"), "utf8")).toBe(
      "roll and mine\n",
    );
  });

  it("come back with what git says when the lead leaves the merge unfinished", async () => {
    await conflicting();
    resolving.run = () => Promise.resolve();
    const asked = await opened("handBack");
    await goals.decide(asked, { kind: "decision", option: "merge" });
    const again = await vi.waitFor(() => {
      const found = core.state.questions.find((q) => q.text);
      if (!found) throw new Error("Not back yet");
      return found;
    }, 5000);
    expect(again.text).toContain("git merge");
    expect(core.state.goal.status).toBe("active");
  });

  it("stop merging as the goal pauses, to ask again as it resumes", async () => {
    await conflicting();
    const { promise: started, resolve } = Promise.withResolvers<undefined>();
    resolving.run = (_checkout, signal) => {
      resolve(undefined);
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          reject(new Error("stopped"));
        });
      });
    };
    await goals.decide(await opened("handBack"), { kind: "decision", option: "merge" });
    await started;
    expect(goals.handingBack()).toEqual({ by: "glm" });
    await goals.pause();
    await vi.waitFor(() => {
      expect(goals.handingBack()).toBeUndefined();
    });
    expect(core.state.goal.status).toBe("paused");
    expect(core.state.questions).toEqual([]);
  });

  it("offer to hand the work back on the acceptance that is all they wait on, or pause on accepting only", async () => {
    const { goal } = core.state;
    await doneWork(true);
    questions.openDecision({ from: "glm", subtaskId: "s1" }, DECISIONS.delivery(), "Game");
    goals.settle();
    const [last] = core.state.questions;
    expect(last?.decision.options).toEqual(["acceptMerge", "acceptOnly", "revise"]);
    if (!last) throw new Error("No acceptance");
    await goals.decide(last, { kind: "decision", option: "acceptOnly" });
    expect(goal.status).toBe("paused");
    expect(scheduler.decide).toHaveBeenCalledWith(last.id, {
      kind: "decision",
      option: "acceptOnly",
    });
  });
});

/** Work done whose README.md conflicts with a commit of yours on main, the goal asking to hand it back. */
async function conflicting() {
  await doneWork(false, true, "README.md");
  const top = core.places.repo.top;
  await writeFile(path.join(top, "README.md"), "mine\n");
  await git({ cwd: top, env: ME }, ["commit", "-q", "-am", "Mine"]);
  goals.settle();
}

/** A task of one subtask, done: merged into the goal's branch with `file`, `withWork`. */
async function doneWork(ownerAccepts: boolean, withWork = true, file = "dice.ts") {
  const { places } = core;
  await openGoal(places, "main");
  if (withWork) {
    const desk = await openDesk(places, "s1");
    await writeFile(path.join(desk, file), "roll\n");
    await commitDesk(places, "s1", "glm", "Roll");
    await mergeDesk(places, "s1");
  }
  core.state.tasks.push({ id: "t1", title: "Game", outcome: "", ownerAccepts });
  const done: Subtask = {
    id: "s1",
    taskId: "t1",
    title: "Roll",
    description: "",
    acceptance: "",
    assignee: "glm",
    dependsOn: [],
    status: "done",
    progress: { done: 0, total: 0 },
  };
  core.state.subtasks.push(done);
}

/** The decision of `kind` once it is put to you. */
async function opened(kind: "handBack" | "cleanUp"): Promise<DecisionQuestion> {
  return vi.waitFor(() => {
    const found = core.state.questions.find((q) => q.decision.kind === kind);
    if (!found) throw new Error(`No ${kind} yet`);
    return found;
    // Its git work takes a while under a full run.
  }, 5000);
}

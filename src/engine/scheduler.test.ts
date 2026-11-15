import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Core } from "./core.ts";
import { git, goalBranch, openRepository } from "./git.ts";
import { Questions, type DecisionAnswer } from "./questions.ts";
import { runSubtask, type RunOutcome } from "./run.ts";
import { Scheduler } from "./scheduler.ts";
import { askOnce } from "./turns.ts";
import type { Member, Subtask } from "./types.ts";
import { goalFiles } from "../shared/layout.ts";

vi.mock("./run.ts", () => ({ runSubtask: vi.fn() }));
vi.mock("./turns.ts", async (original) => ({
  ...(await original<typeof import("./turns.ts")>()),
  askOnce: vi.fn(),
}));

const ME = {
  GIT_AUTHOR_NAME: "you",
  GIT_AUTHOR_EMAIL: "you@example.com",
  GIT_COMMITTER_NAME: "you",
  GIT_COMMITTER_EMAIL: "you@example.com",
};

const member = (name: string): Member => ({
  name,
  role: { id: "dev", title: "Developer", duties: "Build it." },
  env: {},
});

const subtask = (id: string, fields: Partial<Subtask> = {}): Subtask => ({
  id,
  taskId: "t1",
  title: `Make ${id}`,
  description: "",
  acceptance: "",
  assignee: "glm",
  dependsOn: [],
  status: "pending",
  progress: { done: 0, total: 0 },
  ...fields,
});

let dir: string;
let core: Core;
let questions: Questions;
let scheduler: Scheduler;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-scheduler-")));
  const repo = path.join(dir, "repo");
  await git({ cwd: dir }, ["init", "-q", "--initial-branch=main", repo]);
  await writeFile(path.join(repo, "README.md"), "hello\n");
  await git({ cwd: repo, env: ME }, ["add", "-A"]);
  await git({ cwd: repo, env: ME }, ["commit", "-q", "-m", "start"]);
  core = {
    state: {
      goal: { name: "Dice", slug: "dice", status: "active", createdAt: 0 },
      tasks: [{ id: "t1", title: "Board", outcome: "", ownerAccepts: true }],
      subtasks: [],
      meetings: [],
      questions: [],
      tokens: {},
    },
    team: { members: [member("glm"), member("sonnet")], review: false },
    places: { repo: await openRepository(repo), slug: "dice", root: path.join(dir, "data") },
    changed: vi.fn(),
    allowAlways: vi.fn(),
    options: (m, kind, cwd) => ({ cwd, model: kind, settings: `${m.name}.json` }),
    recorder: () => ({}),
    speech: () => ({}),
    underWay: () => scheduler.underWay(),
  };
  questions = new Questions(core);
  scheduler = new Scheduler(core, questions);
  vi.mocked(runSubtask).mockReset();
  vi.mocked(askOnce).mockReset();
});

afterEach(async () => {
  await scheduler.close();
  await rm(dir, { recursive: true, force: true });
});

type Run = Parameters<typeof runSubtask>[0];

/** A run that writes `files` in its worktree and delivers them. */
const delivering =
  (files: Record<string, string>) =>
  async (run: Run): Promise<RunOutcome> => {
    const cwd = run.options.cwd ?? "";
    for (const [file, text] of Object.entries(files)) await writeFile(path.join(cwd, file), text);
    const checked = await run.collaboration.checkDelivery(Object.keys(files));
    if ("refused" in checked) throw new Error(checked.refused);
    return { status: "delivered", handover: { summary: "Done.", files: checked.files }, tokens: 3 };
  };

/** A run that goes on until it is stopped, as runSubtask does: at once, when stopped before it began. */
const working = (run: Run) =>
  new Promise<RunOutcome>((resolve) => {
    const stopped = () => {
      resolve({ status: "stopped", tokens: 0 });
    };
    if (run.signal.aborted) stopped();
    else run.signal.addEventListener("abort", stopped);
  });

/** Waits for `check` to pass: real git is slow while the other test files run alongside. */
const eventually = (check: () => unknown) => vi.waitFor(check, { timeout: 10_000 });

const settled = (s: Subtask, status: Subtask["status"]) =>
  eventually(() => {
    expect(s.status).toBe(status);
  });

/** Answers a decision as Engine.answer does: the question closes, and the scheduler acts on it. */
async function decide(id: string, decided: Omit<DecisionAnswer, "kind">) {
  const answer = { kind: "decision" as const, ...decided };
  const question = questions.answer(id, answer);
  if (question.kind !== "decision") throw new Error(`${id} is not a decision`);
  await scheduler.decide(question, answer);
}

const onGoal = (file: string) =>
  readFile(path.join(goalFiles(core.places.root).checkout, file), "utf8");

describe("Scheduler", () => {
  it("runs a subtask in its worktree, merges its delivery, and puts the task to you", async () => {
    const s1 = subtask("s1");
    core.state.subtasks.push(s1);
    vi.mocked(runSubtask).mockImplementation(delivering({ "score.txt": "0:0\n" }));
    scheduler.pump();
    await settled(s1, "done");

    const run = vi.mocked(runSubtask).mock.lastCall?.[0];
    expect(run?.opening).toContain("Your subtask: Make s1");
    expect(run?.options.model).toBe("work");
    expect(await onGoal("score.txt")).toBe("0:0\n");
    const log = await git({ cwd: core.places.repo.top }, [
      "log",
      "-1",
      "--format=%an%n%s",
      goalBranch("dice"),
    ]);
    expect(log.stdout.trim()).toBe("glm\nMake s1");
    expect(s1).toMatchObject({ delivery: { summary: "Done.", files: ["score.txt"] } });
    expect(core.state.tokens).toEqual({ glm: 3 });
    expect(core.state.questions).toMatchObject([
      {
        subtaskId: "s1",
        text: "Board",
        decision: { kind: "delivery", options: ["accept", "revise"] },
      },
    ]);
  });

  it("hands over a task you don't accept as its last subtask merges, asking nothing", async () => {
    const [task] = core.state.tasks;
    if (task) task.ownerAccepts = false;
    const s1 = subtask("s1");
    core.state.subtasks.push(s1);
    vi.mocked(runSubtask).mockImplementation(delivering({ "score.txt": "0:0\n" }));
    scheduler.pump();
    await settled(s1, "done");
    expect(core.state.questions).toEqual([]);
  });

  it("starts work once what it builds on is merged, and tells it what that was", async () => {
    const s1 = subtask("s1");
    const s2 = subtask("s2", { assignee: "sonnet", dependsOn: ["s1"] });
    core.state.subtasks.push(s1, s2);
    vi.mocked(runSubtask)
      .mockImplementationOnce(delivering({ "rules.txt": "roll\n" }))
      .mockImplementationOnce(async (run) => {
        expect(await readFile(path.join(run.options.cwd ?? "", "rules.txt"), "utf8")).toBe(
          "roll\n",
        );
        return delivering({ "board.txt": "[]\n" })(run);
      });
    scheduler.pump();
    expect([s1.status, s2.status]).toEqual(["running", "pending"]);
    await settled(s2, "done");
    expect(vi.mocked(runSubtask).mock.lastCall?.[0].opening).toContain(
      "- Make s1, by glm: Done. Files: rules.txt",
    );
  });

  it("takes new work as tasks and pending subtasks, their dependencies by key", () => {
    vi.mocked(runSubtask).mockImplementation(working);
    const planned = (key: string, assignee: string, dependsOn: string[] = []) => ({
      key,
      title: key,
      description: "",
      assignee,
      dependsOn,
      acceptance: "",
    });
    const [rules, board, score] = scheduler.assign(
      [
        {
          title: "Game",
          outcome: "Playable",
          ownerAccepts: true,
          subtasks: [planned("a", "glm"), planned("b", "sonnet", ["a"])],
        },
        {
          title: "Score",
          outcome: "",
          ownerAccepts: true,
          subtasks: [planned("c", "sonnet", ["b"])],
        },
      ],
      "m1",
    );
    expect(core.state.tasks.slice(1)).toMatchObject([
      { title: "Game", outcome: "Playable", meetingId: "m1" },
      { title: "Score" },
    ]);
    expect(board?.dependsOn).toEqual([rules?.id]);
    expect(score?.dependsOn).toEqual([board?.id]);
    expect(score?.taskId).toBe(core.state.tasks[2]?.id);
    // Nothing waits on the first, so it starts at once.
    expect([rules?.status, board?.status, score?.status]).toEqual([
      "running",
      "pending",
      "pending",
    ]);
  });

  it("gives a subtask from a plan the plan's document in its brief", async () => {
    core.state.meetings.push({
      id: "m1",
      agenda: "A dice game",
      size: "small",
      participants: ["glm"],
      host: "glm",
      status: "approved",
      turns: [],
      plan: { summary: "Dice", markdown: "# Dice\n\nTwo players.", tasks: [] },
    });
    core.state.tasks = [
      {
        id: "t1",
        title: "Board",
        outcome: "",
        meetingId: "m1",
        ownerAccepts: true,
      },
    ];
    const s1 = subtask("s1");
    core.state.subtasks.push(s1);
    vi.mocked(runSubtask).mockImplementation(delivering({ "rules.txt": "roll\n" }));
    scheduler.pump();
    await settled(s1, "done");
    expect(vi.mocked(runSubtask).mock.lastCall?.[0].opening).toContain("# Dice\n\nTwo players.");
  });

  it("fails a run with its error, and refuses files not in the worktree", async () => {
    const s1 = subtask("s1");
    core.state.subtasks.push(s1);
    vi.mocked(runSubtask).mockImplementation(async (run) => {
      const checked = await run.collaboration.checkDelivery(["../escape.txt", "missing.txt"]);
      return { status: "failed", error: JSON.stringify(checked), tokens: 1 };
    });
    scheduler.pump();
    await settled(s1, "failed");
    expect(s1.error).toContain("Not delivered: these aren't files in your worktree");
    expect(s1.error).toContain("../escape.txt, missing.txt");
  });

  it("sends a text conflict back to its member, who resolves it in the same session", async () => {
    const s1 = subtask("s1");
    const s2 = subtask("s2", { assignee: "sonnet" });
    core.state.subtasks.push(s1, s2);
    let second: Run | undefined;
    vi.mocked(runSubtask)
      .mockImplementationOnce(delivering({ "README.md": "from glm\n" }))
      .mockImplementationOnce(async (run) => {
        // Delivered only after the other's merge, so its own merge meets it.
        await settled(s1, "done");
        return delivering({ "README.md": "from sonnet\n" })(run);
      })
      .mockImplementationOnce(async (run) => {
        second = run;
        expect(await run.collaboration.checkDelivery(["README.md"])).toMatchObject({
          refused: expect.stringContaining("conflict markers are still in README.md") as string,
        });
        return delivering({ "README.md": "from both\n" })(run);
      });
    s2.session = "sonnet-1";
    scheduler.pump();
    await eventually(() => {
      expect(second).toBeDefined();
    });
    expect(second?.resume).toBe("sonnet-1");
    expect(second?.opening).toContain("left conflicts in README.md");
    await settled(s2, "done");
    expect(await onGoal("README.md")).toBe("from both\n");
  });

  it("has a teammate answer in a read-only session in the goal's worktree", async () => {
    const s1 = subtask("s1");
    core.state.subtasks.push(s1);
    vi.mocked(askOnce).mockImplementation((ask) => {
      ask.spent(5);
      return Promise.resolve({ text: "Inter", session: "x" });
    });
    const told: string[] = [];
    vi.mocked(runSubtask).mockImplementation(async (run) => {
      told.push(await run.collaboration.askTeammate(" sonnet ", "Which font?"));
      told.push(await run.collaboration.askTeammate("ann", "?"));
      told.push(await run.collaboration.askTeammate("glm", "?"));
      return { status: "failed", error: "enough", tokens: 0 };
    });
    scheduler.pump();
    await settled(s1, "failed");
    expect(told).toEqual([
      "sonnet answered: Inter",
      'There\'s no teammate called "ann". Your teammates: sonnet.',
      "That's you; no need to ask.",
    ]);
    expect(vi.mocked(askOnce).mock.lastCall?.[0].options).toEqual({
      cwd: goalFiles(core.places.root).checkout,
      model: "readOnly",
      settings: "sonnet.json",
    });
    // The answer's tokens are the one who answered.
    expect(core.state.tokens.sonnet).toBe(5);
  });

  describe("with review on", () => {
    beforeEach(() => {
      core.team = { ...core.team, review: true };
    });

    it("has another member review the delivery in its worktree before it is merged", async () => {
      const s1 = subtask("s1", { acceptance: "Shows both scores" });
      core.state.subtasks.push(s1);
      vi.mocked(runSubtask).mockImplementation(delivering({ "score.txt": "0:0\n" }));
      vi.mocked(askOnce).mockImplementation((ask) => {
        ask.spent(7);
        return Promise.resolve({
          text: "",
          structured: { pass: true, notes: "Fine." },
          session: "r",
        });
      });
      scheduler.pump();
      await settled(s1, "done");
      const review = vi.mocked(askOnce).mock.lastCall?.[0];
      expect(review?.options).toEqual({
        cwd: path.join(core.places.root, "desks", "s1"),
        model: "readOnly",
        settings: "sonnet.json",
      });
      expect(review?.prompt).toContain("Acceptance criteria: Shows both scores");
      expect(review?.schema?.safeParse({ pass: true, notes: "Fine." }).success).toBe(true);
      expect(s1).toMatchObject({ review: { rounds: 0, notes: "Fine." } });
      // The run is the author's, the review the reviewer's.
      expect(core.state.tokens).toEqual({ glm: 3, sonnet: 7 });
    });

    it("sends it back with the notes twice, then puts it to you, to send back with your words", async () => {
      const s1 = subtask("s1", { session: "glm-1" });
      core.state.subtasks.push(s1);
      vi.mocked(runSubtask).mockImplementation(delivering({ "score.txt": "0:0\n" }));
      vi.mocked(askOnce).mockResolvedValue({
        text: "",
        structured: { pass: false, notes: "Scores overlap" },
        session: "r",
      });
      scheduler.pump();
      await eventually(() => {
        expect(core.state.questions).toHaveLength(1);
      });
      const runs = vi.mocked(runSubtask).mock.calls.map(([run]) => run);
      expect(runs).toHaveLength(3);
      expect(runs[1]?.opening).toContain("The review sent your delivery back");
      expect(runs[1]?.opening).toContain("Scores overlap");
      expect(s1).toMatchObject({ status: "reviewing", review: { rounds: 3 } });
      expect(core.state.questions[0]).toMatchObject({
        text: "Scores overlap",
        decision: { kind: "review", options: ["rereview", "skip", "sendBack"] },
      });
      await decide(core.state.questions[0]?.id ?? "", {
        option: "sendBack",
        note: "Keep the board",
      });
      await eventually(() => {
        expect(vi.mocked(runSubtask).mock.calls.length).toBeGreaterThan(3);
      });
      expect(vi.mocked(runSubtask).mock.calls[3]?.[0].opening).toBe(
        "The review sent your delivery back. Fix what it says, then deliver again:\nScores overlap\n\nThe user adds to your subtask:\nKeep the board",
      );
    });

    it("puts a review that fails to you, to send back with your words alone", async () => {
      const s1 = subtask("s1", { session: "glm-1", review: { rounds: 1, notes: "Old notes" } });
      core.state.subtasks.push(s1);
      vi.mocked(runSubtask).mockImplementation(delivering({ "score.txt": "0:0\n" }));
      vi.mocked(askOnce).mockRejectedValue(new Error("API Error: 529"));
      scheduler.pump();
      await eventually(() => {
        expect(core.state.questions).toMatchObject([
          {
            text: "API Error: 529",
            decision: { kind: "review", note: { option: "sendBack", needed: true } },
          },
        ]);
      });
      await decide(core.state.questions[0]?.id ?? "", { option: "sendBack", note: "Bigger" });
      await eventually(() => {
        expect(vi.mocked(runSubtask).mock.calls.length).toBe(2);
      });
      expect(vi.mocked(runSubtask).mock.calls[1]?.[0].opening).toBe(
        "The user adds to your subtask:\nBigger",
      );
    });
  });

  describe("your actions", () => {
    const runs = () => vi.mocked(runSubtask).mock.calls.map(([run]) => run);

    it("stop a run, which then goes on in its session", async () => {
      const s1 = subtask("s1", { session: "glm-1" });
      core.state.subtasks.push(s1);
      vi.mocked(runSubtask)
        .mockImplementationOnce(working)
        .mockImplementationOnce(delivering({ "score.txt": "1\n" }));
      scheduler.pump();
      await eventually(() => {
        expect(runs()).toHaveLength(1);
      });
      await scheduler.act("s1", "stop");
      expect(s1.status).toBe("stopped");
      await scheduler.act("s1", "continue");
      await settled(s1, "done");
      expect(runs()[1]).toMatchObject({
        resume: "glm-1",
        opening: "The user asks you to go on from where you stopped.",
      });
    });

    it("go on with a failed subtask in its session and worktree", async () => {
      const s1 = subtask("s1");
      core.state.subtasks.push(s1);
      vi.mocked(runSubtask)
        .mockImplementationOnce(async (run) => {
          run.listener.session?.("glm-1", "m");
          await writeFile(path.join(run.options.cwd ?? "", "half.txt"), "half\n");
          return { status: "failed", error: "API Error: 529", tokens: 0 };
        })
        .mockImplementationOnce(async (run) => {
          expect(await readFile(path.join(run.options.cwd ?? "", "half.txt"), "utf8")).toBe(
            "half\n",
          );
          return delivering({ "score.txt": "1\n" })(run);
        });
      scheduler.pump();
      await settled(s1, "failed");
      await scheduler.act("s1", "continue");
      await settled(s1, "done");
      expect(runs()[1]?.resume).toBe("glm-1");
    });

    it("retry a failed subtask from the start", async () => {
      const s1 = subtask("s1");
      core.state.subtasks.push(s1);
      vi.mocked(runSubtask)
        .mockImplementationOnce(async (run) => {
          run.listener.session?.("glm-1", "m");
          await writeFile(path.join(run.options.cwd ?? "", "half.txt"), "half\n");
          return { status: "failed", error: "API Error: 529", tokens: 0 };
        })
        .mockImplementationOnce(async (run) => {
          await expect(readFile(path.join(run.options.cwd ?? "", "half.txt"))).rejects.toThrow();
          return delivering({ "score.txt": "1\n" })(run);
        });
      scheduler.pump();
      await settled(s1, "failed");
      expect(s1).toMatchObject({ session: "glm-1", error: "API Error: 529" });
      await scheduler.act("s1", "retry");
      await settled(s1, "done");
      expect(runs()[1]?.resume).toBeUndefined();
      expect(runs()[1]?.opening).toContain("Your subtask: Make s1");
    });

    it("stop a review, which goes on later with the delivery standing", async () => {
      core.team = { ...core.team, review: true };
      const s1 = subtask("s1");
      core.state.subtasks.push(s1);
      vi.mocked(runSubtask).mockImplementation(delivering({ "score.txt": "1\n" }));
      vi.mocked(askOnce)
        .mockImplementationOnce(
          ({ signal }) =>
            new Promise((_, reject) => {
              signal.addEventListener("abort", () => {
                reject(new Error("stopped"));
              });
            }),
        )
        .mockResolvedValueOnce({
          text: "",
          structured: { pass: true, notes: "" },
          session: "r",
        });
      scheduler.pump();
      await eventually(() => {
        expect(askOnce).toHaveBeenCalledTimes(1);
      });
      await scheduler.act("s1", "stop");
      expect(s1).toMatchObject({ status: "stoppedInReview" });
      await scheduler.act("s1", "continue");
      await settled(s1, "done");
      expect(runSubtask).toHaveBeenCalledTimes(1);
      expect(core.state.questions).toMatchObject([{ decision: { kind: "delivery" } }]);
    });

    it("decide a stuck review: skip it, and it is merged", async () => {
      core.team = { ...core.team, review: true };
      const s1 = subtask("s1");
      core.state.subtasks.push(s1);
      vi.mocked(runSubtask).mockImplementation(delivering({ "score.txt": "1\n" }));
      vi.mocked(askOnce).mockRejectedValue(new Error("API Error: 529"));
      scheduler.pump();
      await eventually(() => {
        expect(core.state.questions).toHaveLength(1);
      });
      const [stuck] = core.state.questions;
      await decide(stuck?.id ?? "", { option: "skip" });
      await settled(s1, "done");
    });

    it("send a task back, its subtask going on in its session with what you want changed", async () => {
      const s1 = subtask("s1", { session: "glm-1" });
      core.state.subtasks.push(s1);
      vi.mocked(runSubtask).mockImplementation(delivering({ "score.txt": "1\n" }));
      scheduler.pump();
      await eventually(() => {
        expect(core.state.questions).toHaveLength(1);
      });
      await decide(core.state.questions[0]?.id ?? "", {
        option: "revise",
        note: "Bigger numbers",
      });
      await eventually(() => {
        expect(runs()).toHaveLength(2);
      });
      expect(runs()[1]).toMatchObject({
        resume: "glm-1",
        opening:
          "The user sent your task back, asking for:\nBigger numbers\nMake those changes, then deliver again.",
      });
      await settled(s1, "done");
    });

    it("keep one side of a file that can't be merged line by line", async () => {
      const s1 = subtask("s1");
      const s2 = subtask("s2", { assignee: "sonnet" });
      core.state.subtasks.push(s1, s2);
      vi.mocked(runSubtask)
        .mockImplementationOnce(delivering({ "logo.bin": "glm\0\n" }))
        .mockImplementationOnce(async (run) => {
          await settled(s1, "done");
          return delivering({ "logo.bin": "sonnet\0\n" })(run);
        });
      scheduler.pump();
      await eventually(() => {
        expect(core.state.questions).toMatchObject([
          {
            kind: "decision",
            decision: { kind: "merge", options: ["ours", "theirs", "retry"], files: ["logo.bin"] },
          },
        ]);
      });
      await decide(core.state.questions[0]?.id ?? "", { option: "ours" });
      await settled(s2, "done");
      expect(await onGoal("logo.bin")).toBe("sonnet\0\n");
    });

    it("redo work whose upstream was redone, in its session", async () => {
      const s1 = subtask("s1", { status: "done", finishedAt: 20 });
      const s2 = subtask("s2", {
        status: "done",
        dependsOn: ["s1"],
        startedAt: 10,
        session: "glm-2",
      });
      core.state.subtasks.push(s1, s2);
      vi.mocked(runSubtask).mockImplementation(delivering({ "board.txt": "2\n" }));
      await scheduler.act("s2", "redo");
      await settled(s2, "done");
      expect(runs()[0]).toMatchObject({
        resume: "glm-2",
        opening: expect.stringContaining(
          "Work you build on was redone after you delivered: Make s1.",
        ) as string,
      });
    });
  });

  it("refuses what can't be done to a subtask where it stands", async () => {
    const s1 = subtask("s1", { status: "done", finishedAt: 5 });
    const s2 = subtask("s2", { status: "done", dependsOn: ["s1"], startedAt: 10 });
    core.state.subtasks.push(s1, s2);
    await expect(scheduler.act("s2", "redo")).rejects.toThrow("can't redo while done");
    await expect(scheduler.act("s1", "retry")).rejects.toThrow("can't retry while done");
    await expect(scheduler.act("gone", "stop")).rejects.toThrow("There is no such subtask");
    expect(s2.status).toBe("done");
  });

  describe("work on hold", () => {
    const runs = () => vi.mocked(runSubtask).mock.calls.map(([run]) => run);
    const started = (n: number) =>
      eventually(() => {
        expect(runs()).toHaveLength(n);
      });

    it("stops with its goal, and goes on in its session when the goal is resumed", async () => {
      const s1 = subtask("s1", { session: "glm-1" });
      core.state.subtasks.push(s1);
      vi.mocked(runSubtask)
        .mockImplementationOnce(working)
        .mockImplementationOnce(delivering({ "score.txt": "1\n" }));
      scheduler.pump();
      await started(1);
      const { goal } = core.state;
      goal.status = "paused";
      scheduler.hold();
      await settled(s1, "pending");
      expect(s1.goOn).toEqual([{ why: "held" }]);
      scheduler.pump();
      expect(runs()).toHaveLength(1);
      goal.status = "active";
      scheduler.pump();
      await settled(s1, "done");
      expect(runs()[1]).toMatchObject({
        resume: "glm-1",
        opening: "Your work was paused and now goes on. Pick up where you left off.",
      });
    });

    it("takes what you add to it: a run stops and goes on with it, one not started hears it first", async () => {
      const s1 = subtask("s1", { session: "glm-1" });
      const s2 = subtask("s2", { assignee: "sonnet" });
      core.state.subtasks.push(s1, s2);
      vi.mocked(runSubtask).mockImplementation(async (run) =>
        run.opening.includes("Make s1") && !run.resume
          ? working(run)
          : delivering({ [`${run.resume ?? "s2"}.txt`]: "x\n" })(run),
      );
      expect(scheduler.carry("s2", "Use blue")).toBe("goes");
      scheduler.pump();
      await settled(s2, "done");
      expect(runs().find((r) => r.opening.includes("Make s2"))?.opening).toContain(
        "The user adds to your subtask:\nUse blue",
      );
      expect(scheduler.carry("s1", "Top right")).toBe("goes");
      await settled(s1, "done");
      expect(runs().at(-1)).toMatchObject({
        resume: "glm-1",
        opening: "The user adds to your subtask:\nTop right",
      });
    });

    it("keeps how a run held as its session closes ended, what you added to it too", async () => {
      const s1 = subtask("s1", { session: "glm-1" });
      core.state.subtasks.push(s1);
      vi.mocked(runSubtask).mockImplementation(working);
      scheduler.pump();
      await started(1);
      expect(scheduler.carry("s1", "Top right")).toBe("goes");
      core.state.goal.status = "paused";
      scheduler.hold();
      await scheduler.close();
      expect(s1.status).toBe("pending");
      expect(s1.goOn).toEqual([{ why: "carried", note: "Top right" }, { why: "held" }]);
    });

    it("isn't added to while handed over, while its goal is paused, or when there is none", () => {
      core.state.subtasks.push(subtask("s1", { status: "reviewing" }), subtask("s2"));
      expect(scheduler.carry("s1", "x")).toBe("handedOver");
      const { goal } = core.state;
      goal.status = "paused";
      expect(scheduler.carry("s2", "x")).toBe("onHold");
      expect(() => scheduler.carry("s9", "x")).toThrow("There is no such subtask");
    });

    it("is let go of before it is deleted, once its run has ended", async () => {
      const s1 = subtask("s1", { session: "glm-1" });
      core.state.subtasks.push(s1);
      vi.mocked(runSubtask).mockImplementation(working);
      scheduler.pump();
      await started(1);
      scheduler.hold();
      await scheduler.release(["s1"]);
      expect(s1.status).toBe("stopped");
    });

    it("goes on in its session after a restart", () => {
      const s1 = subtask("s1", { status: "running", session: "glm-1" });
      const s2 = subtask("s2", { status: "running" });
      core.state.subtasks.push(s1, s2);
      scheduler.recover();
      expect([s1.status, s1.goOn, s2.status, s2.goOn]).toEqual([
        "pending",
        [{ why: "held" }],
        "pending",
        undefined,
      ]);
    });
  });
});

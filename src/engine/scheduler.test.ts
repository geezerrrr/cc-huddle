import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Core } from "./core.ts";
import { git, goalBranch, goalFolder, openRepository } from "./git.ts";
import { Questions } from "./questions.ts";
import { runSubtask, type RunOutcome } from "./run.ts";
import { Scheduler } from "./scheduler.ts";
import { askOnce } from "./turns.ts";
import type { Member, Subtask } from "./types.ts";

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
  goalId: "g1",
  title: `Make ${id}`,
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
      goals: [{ id: "g1", name: "Dice", slug: "dice", status: "active", createdAt: 0 }],
      tasks: [{ id: "t1", goalId: "g1", title: "Board", outcome: "", createdAt: 0 }],
      subtasks: [],
      meetings: [],
      questions: [],
    },
    team: { members: [member("glm"), member("sonnet")], review: false },
    places: { repo: await openRepository(repo), root: path.join(dir, "data") },
    changed: vi.fn(),
    allowAlways: vi.fn(),
    options: (_, kind, cwd) => Promise.resolve({ cwd, model: kind }),
    recorder: () => ({}),
  };
  questions = new Questions(core);
  scheduler = new Scheduler(core, questions);
  vi.mocked(runSubtask).mockReset();
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

const settled = (s: Subtask, status: Subtask["status"]) =>
  vi.waitFor(() => {
    expect(s.status).toBe(status);
  });

const onGoal = (file: string) => readFile(path.join(goalFolder(core.places, "dice"), file), "utf8");

describe("Scheduler", () => {
  it("runs a subtask in its worktree, merges its delivery, and puts the task to you", async () => {
    const s1 = subtask("s1");
    core.state.subtasks.push(s1);
    vi.mocked(runSubtask).mockImplementation(delivering({ "score.txt": "0:0\n" }));
    scheduler.pump();
    await settled(s1, "done");

    const run = vi.mocked(runSubtask).mock.lastCall?.[0];
    expect(run?.opening).toContain("Your subtask: Make s1");
    expect(run?.options.model).toBe("task");
    expect(await onGoal("score.txt")).toBe("0:0\n");
    const log = await git({ cwd: core.places.repo.top }, [
      "log",
      "-1",
      "--format=%an%n%s",
      goalBranch("dice"),
    ]);
    expect(log.stdout.trim()).toBe("glm\nMake s1");
    expect(s1).toMatchObject({ tokens: 3, delivery: { summary: "Done.", files: ["score.txt"] } });
    expect(core.state.questions).toMatchObject([
      {
        subtaskId: "s1",
        text: "Board",
        decision: { kind: "delivery", options: ["accept", "revise"] },
      },
    ]);
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
    await vi.waitFor(() => {
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
    vi.mocked(askOnce).mockResolvedValue({ text: "Inter", session: "x", tokens: 5 });
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
      cwd: goalFolder(core.places, "dice"),
      model: "answer",
    });
    expect(s1.tokens).toBe(5);
  });
});

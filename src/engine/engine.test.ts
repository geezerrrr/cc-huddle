import { DECISIONS } from "./types.ts";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Core } from "./core.ts";
import { holderOf } from "./data.ts";
import { goalFiles, goalsFolder, repoFolder } from "../shared/layout.ts";
import { Engine, type EngineOptions } from "./engine.ts";
import { git, goalBranch, openRepository } from "./git.ts";
import { Goals } from "./goals.ts";
import { runSubtask, type RunOutcome } from "./run.ts";
import { readCopy, teamFolder } from "./team.ts";

vi.mock("./run.ts", () => ({ runSubtask: vi.fn() }));

const ME = {
  GIT_AUTHOR_NAME: "you",
  GIT_AUTHOR_EMAIL: "you@example.com",
  GIT_COMMITTER_NAME: "you",
  GIT_COMMITTER_EMAIL: "you@example.com",
};

let dir: string;
let repo: string;
let options: EngineOptions;
/** The folder of the repository's goals. */
let goals: string;
const opened: Engine[] = [];

/** Writes a file of the team. */
async function teamFile(name: string, text: string) {
  const file = path.join(teamFolder(repo), name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

const keep = (engine: Engine) => {
  opened.push(engine);
  return engine;
};
const start = async (name = "Dice", with_: Partial<EngineOptions> = {}) =>
  keep(await Engine.start({ ...options, ...with_ }, name));
const takeUp = async (slug: string, with_: Partial<EngineOptions> = {}) =>
  keep(await Engine.takeUp({ ...options, ...with_ }, slug));
/** Closes an engine the test is done with. */
const close = (engine: Engine) => {
  opened.splice(opened.indexOf(engine), 1);
  return engine.close();
};

const filesOf = (slug: string) => goalFiles(path.join(goals, slug));
const saved = async (slug: string): Promise<unknown> =>
  JSON.parse(await readFile(filesOf(slug).state, "utf8"));

/** A member run that goes on until it is stopped. */
const working: typeof runSubtask = (run) =>
  new Promise<RunOutcome>((resolve) => {
    const stopped = () => {
      resolve({ status: "stopped", tokens: 0 });
    };
    if (run.signal.aborted) stopped();
    else run.signal.addEventListener("abort", stopped);
  });

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-engine-")));
  repo = path.join(dir, "repo");
  await git({ cwd: dir }, ["init", "-q", "--initial-branch=main", repo]);
  await writeFile(path.join(repo, "README.md"), "hello\n");
  await git({ cwd: repo, env: ME }, ["add", "-A"]);
  await git({ cwd: repo, env: ME }, ["commit", "-q", "-m", "start"]);
  await teamFile("roles/dev.md", "---\ntitle: Developer\n---\nBuild it.");
  await teamFile(
    "members/glm.md",
    "---\nrole: dev\nenv:\n  ANTHROPIC_AUTH_TOKEN: ${GLM_KEY}\n---\n",
  );
  const dataFolder = path.join(dir, "openplan-inline");
  options = {
    cwd: repo,
    dataFolder,
    claude: "claude",
    session: 41,
    address: "here",
    takeOver: () => Promise.reject(new Error("not asked")),
    sessionMode: () => undefined,
    plugins: ["openplan@inline"],
    userTeam: path.join(dir, "user-team"),
    env: { GLM_KEY: "key-1" },
    failed: vi.fn(),
  };
  goals = goalsFolder(repoFolder(dataFolder, await openRepository(repo)));
  vi.mocked(runSubtask).mockImplementation(working);
});

afterEach(async () => {
  for (const engine of opened.splice(0)) await engine.close();
  await rm(dir, { recursive: true, force: true });
});

describe("Engine", () => {
  it("starts a goal in a folder of its own: its copy of the team, its branch and worktree, the lock", async () => {
    const engine = await start("Dice game");
    const { goal } = engine.state;
    expect(goal).toMatchObject({ name: "Dice game", slug: "dice-game", status: "active" });
    expect(engine.team.members.map((m) => m.name)).toEqual(["glm"]);
    expect(engine.meetingSize).toBe("discussion");
    const files = filesOf("dice-game");
    // The copy keeps a member's environment as written; their settings file has it filled in.
    expect((await readCopy(files.team)).team.members[0]?.env).toEqual({
      ANTHROPIC_AUTH_TOKEN: "${GLM_KEY}",
    });
    expect(JSON.parse(await readFile(files.settings("glm"), "utf8"))).toMatchObject({
      env: { ANTHROPIC_AUTH_TOKEN: "key-1" },
      enabledPlugins: { "openplan@inline": false },
    });
    expect(
      await readFile(
        path.join(goalFiles(path.join(goals, "dice-game")).checkout, "README.md"),
        "utf8",
      ),
    ).toBe("hello\n");
    expect(holderOf(files.lock)).toEqual({
      pid: process.pid,
      session: 41,
      address: "here",
    });
    expect(await saved("dice-game")).toMatchObject({ state: { goal: { status: "active" } } });

    await engine.goals.pause();
    await close(engine);
    const second = await start("Dice game");
    expect(second.state.goal.slug).toBe("dice-game-2");
    const refs = await git({ cwd: repo }, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads/",
    ]);
    expect(refs.stdout.split("\n").filter(Boolean).sort()).toEqual(
      ["main", goalBranch("dice-game"), goalBranch("dice-game-2")].sort(),
    );
  });

  it("works its goal with the team as it started, whatever the team's files say after", async () => {
    const engine = await start();
    await teamFile("members/ann.md", "---\nrole: dev\n---\n");
    expect(engine.team.members.map((m) => m.name)).toEqual(["glm"]);
    await close(engine);
    const again = await takeUp("dice");
    expect(again.team.members.map((m) => m.name)).toEqual(["glm"]);
    const next = await start("Chess");
    expect(next.team.members.map((m) => m.name)).toEqual(["ann", "glm"]);
  });

  it("works members in your session's permission mode, unless the team sets theirs", async () => {
    const session: { mode?: PermissionMode } = {};
    const engine = await start("Dice", { sessionMode: () => session.mode });
    const { core } = engine as unknown as { core: Core };
    const [glm] = engine.team.members;
    if (!glm) throw new Error("no member");
    const working = () => core.options(glm, "work", repo).permissionMode;
    expect(working()).toBeUndefined();
    session.mode = "bypassPermissions";
    expect(working()).toBe("bypassPermissions");
    expect(core.options(glm, "readOnly", repo).permissionMode).toBe("dontAsk");

    await teamFile(
      "settings.json",
      JSON.stringify({ permissions: { defaultMode: "acceptEdits" } }),
    );
    const set = await start("Chess", { sessionMode: () => session.mode });
    const { core: setCore } = set as unknown as { core: Core };
    expect(setCore.options(glm, "work", repo).permissionMode).toBeUndefined();
  });

  it("allows a rule always in the repository's team settings and the goal's copy", async () => {
    const engine = await start();
    const { core } = engine as unknown as { core: Core };
    await core.allowAlways(["Bash(npm test)"]);
    const files = filesOf("dice");
    expect((await readCopy(files.team)).settings.permissions?.allow).toEqual(["Bash(npm test)"]);
    expect(JSON.parse(await readFile(files.settings("glm"), "utf8"))).toMatchObject({
      permissions: { allow: ["Bash(npm test)"] },
    });
    expect(
      JSON.parse(await readFile(path.join(teamFolder(repo), "settings.json"), "utf8")),
    ).toEqual({ permissions: { allow: ["Bash(npm test)"] } });
  });

  it("starts nothing without a team, or without a member's key", async () => {
    await expect(start("Dice", { env: {} })).rejects.toThrow(
      "glm: Not set in the environment: GLM_KEY",
    );
    await rm(teamFolder(repo), { recursive: true });
    await expect(start()).rejects.toThrow("The team has no members");
    await expect(stat(goals)).rejects.toThrow();
  });

  it("pauses its goal as it closes, writes the state, lets the goal go, and writes no more", async () => {
    const engine = await start();
    expect(await close(engine)).toEqual({ meetings: [] });
    expect(await saved("dice")).toMatchObject({ state: { goal: { status: "paused" } } });
    expect(holderOf(filesOf("dice").lock)).toBeUndefined();
    engine.state.goal.name = "Gone";
    (engine as unknown as { core: Core }).core.changed();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await saved("dice")).toMatchObject({ state: { goal: { name: "Dice" } } });
  });

  it("lets its goal go even when stopping what runs fails", async () => {
    const engine = await start();
    vi.spyOn(engine.scheduler, "close").mockRejectedValueOnce(new Error("stuck"));
    await expect(close(engine)).rejects.toThrow("stuck");
    expect(holderOf(filesOf("dice").lock)).toBeUndefined();
  });

  it("goes on with the meetings the session that let the goal go stopped", async () => {
    await close(await start());
    const files = filesOf("dice");
    const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    await once(other, "spawn");
    await writeFile(files.lock, JSON.stringify({ pid: other.pid, session: 7, address: "there" }));
    const resume = vi.spyOn(Goals.prototype, "resume").mockResolvedValueOnce();
    await takeUp("dice", {
      takeOver: async () => {
        await rm(files.lock);
        return { meetings: ["m1"] };
      },
    });
    other.kill();
    expect(resume).toHaveBeenCalledWith(["m1"]);
    resume.mockRestore();
  });

  it("takes a goal up, asking the session that holds it to let it go, and resumes it", async () => {
    await close(await start());
    const files = filesOf("dice");
    const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    await once(other, "spawn");
    await writeFile(files.lock, JSON.stringify({ pid: other.pid, session: 7, address: "there" }));
    const asked: string[] = [];
    const engine = await takeUp("dice", {
      takeOver: async (holder, slug) => {
        asked.push(`${holder.address} ${slug}`);
        await rm(files.lock);
        return { meetings: [] };
      },
    });
    other.kill();
    expect(asked).toEqual(["there dice"]);
    expect(engine.state.goal.status).toBe("active");
    expect(holderOf(files.lock)).toMatchObject({ session: 41, address: "here" });
    await expect(takeUp("chess")).rejects.toThrow('There is no goal "chess"');
  });

  it("takes nothing from the session that runs a goal when a member's key isn't here", async () => {
    await close(await start());
    const asked: string[] = [];
    await expect(
      takeUp("dice", {
        env: {},
        takeOver: (holder) => {
          asked.push(holder.address);
          return Promise.resolve({ meetings: [] });
        },
      }),
    ).rejects.toThrow("glm: Not set in the environment: GLM_KEY");
    expect(asked).toEqual([]);
    expect(holderOf(filesOf("dice").lock)).toBeUndefined();
  });

  it("pauses what a session killed outright left running, then resumes it, its runs going on in their sessions", async () => {
    const engine = await start();
    engine.abandon();
    opened.splice(0);
    const subtask = {
      id: "s1",
      taskId: "t1",
      title: "Rules",
      description: "",
      acceptance: "",
      assignee: "glm",
      dependsOn: [],
      status: "running",
      progress: { done: 0, total: 0 },
      tokens: 0,
      session: "glm-1",
    };
    const was = (await saved("dice")) as {
      version: number;
      state: { tasks: unknown[]; subtasks: unknown[] };
    };
    was.state.tasks.push({
      id: "t1",
      title: "Game",
      outcome: "",
      ownerAccepts: false,
    });
    was.state.subtasks.push(subtask);
    await writeFile(filesOf("dice").state, JSON.stringify(was));
    const again = await takeUp("dice");
    expect(again.state.goal.status).toBe("active");
    await vi.waitFor(() => {
      expect(runSubtask).toHaveBeenCalledWith(
        expect.objectContaining({ resume: "glm-1" }) as unknown,
      );
    });
  });

  it("deletes an archived goal: its folder goes, its branch stays", async () => {
    const engine = await start();
    await expect(engine.delete()).rejects.toThrow("isn't archived");
    await engine.goals.archive();
    await engine.delete();
    opened.splice(0);
    expect(await readdir(goals)).toEqual([]);
    const refs = await git({ cwd: repo }, [
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads/",
    ]);
    expect(refs.stdout.split("\n").filter(Boolean)).toEqual(["main", goalBranch("dice")]);
  });

  it("answers a question put to you and carries out the decision", async () => {
    const engine = await start();
    await engine.goals.pause();
    engine.state.tasks.push({
      id: "t1",
      title: "Game",
      outcome: "",
      ownerAccepts: true,
    });
    const subtask = {
      id: "s1",
      taskId: "t1",
      title: "Rules",
      description: "",
      acceptance: "",
      assignee: "glm",
      dependsOn: [],
      status: "done" as const,
      progress: { done: 0, total: 0 },
      tokens: 0,
    };
    engine.state.subtasks.push(subtask);
    engine.questions.openDecision(subtask, DECISIONS.delivery(), "Game");
    const [question] = engine.state.questions;
    await expect(engine.answer(question?.id ?? "", { decision: "revise" })).rejects.toThrow(
      "doesn't fit",
    );
    await engine.answer(question?.id ?? "", { decision: "revise", note: "Bigger dice" });
    expect(engine.state.questions).toEqual([]);
    expect(engine.state.subtasks[0]).toMatchObject({
      status: "pending",
      goOn: [{ why: "revised", note: "Bigger dice" }],
    });
  });
});

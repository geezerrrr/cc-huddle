import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dataFiles, holderOf, repoFolder } from "./data.ts";
import { Engine, type EngineOptions } from "./engine.ts";
import { git, openRepository } from "./git.ts";
import { teamFolder } from "./team.ts";

const ME = {
  GIT_AUTHOR_NAME: "you",
  GIT_AUTHOR_EMAIL: "you@example.com",
  GIT_COMMITTER_NAME: "you",
  GIT_COMMITTER_EMAIL: "you@example.com",
};

let dir: string;
let repo: string;
let options: EngineOptions;
let files: ReturnType<typeof dataFiles>;
const opened: Engine[] = [];

/** Writes a file of the team. */
async function teamFile(name: string, text: string) {
  const file = path.join(teamFolder(repo), name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

const open = async (with_: Partial<EngineOptions> = {}) => {
  const engine = await Engine.open({ ...options, ...with_ });
  opened.push(engine);
  return engine;
};

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
    plugin: "openplan@inline",
    userTeam: path.join(dir, "user-team"),
    env: { GLM_KEY: "key-1" },
    teamRead: vi.fn(),
    failed: vi.fn(),
  };
  files = dataFiles(repoFolder(dataFolder, await openRepository(repo)));
});

afterEach(async () => {
  for (const engine of opened.splice(0)) await engine.close();
  await rm(dir, { recursive: true, force: true });
});

const saved = async (): Promise<unknown> => JSON.parse(await readFile(files.state, "utf8"));

describe("Engine", () => {
  it("opens the team for one session, with each member's settings written", async () => {
    const engine = await open();
    expect(engine.team.members.map((m) => m.name)).toEqual(["glm"]);
    expect(engine.meetingSize).toBe("discussion");
    expect(JSON.parse(await readFile(files.settings("glm"), "utf8"))).toMatchObject({
      env: { ANTHROPIC_AUTH_TOKEN: "key-1" },
      enabledPlugins: { "openplan@inline": false },
    });
    expect(holderOf(files.lock)).toEqual({
      pid: process.pid,
      session: 41,
      address: "here",
      open: true,
    });
  });

  it("leaves a repository without a team as it is", async () => {
    await rm(teamFolder(repo), { recursive: true });
    await expect(open()).rejects.toThrow("The team has no members");
    await expect(stat(path.dirname(files.lock))).rejects.toThrow();
  });

  it("pauses every active goal as it closes, writes the state, and lets the team go", async () => {
    const engine = await open();
    const goal = await engine.goals.start("Dice");
    await engine.close();
    opened.splice(0);
    expect(await saved()).toMatchObject({ state: { goals: [{ id: goal.id, status: "paused" }] } });

    const again = await open();
    expect(again.state.goals).toMatchObject([{ id: goal.id, status: "paused" }]);
  });

  it("gives what it stopped as it closes, and writes no more", async () => {
    const engine = await open();
    const goal = await engine.goals.start("Dice");
    expect(await engine.close()).toEqual({ goals: [goal.id], meetings: [] });
    opened.splice(0);
    for (const g of engine.state.goals) g.name = "Gone";
    await engine.reloadTeam();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await saved()).toMatchObject({ state: { goals: [{ name: "Dice", status: "paused" }] } });
  });

  it("takes a team another session holds only when asked to, and goes on with what it handed over", async () => {
    const goal = { id: "g1", name: "Dice", slug: "dice", status: "paused", createdAt: 0 };
    await mkdir(path.dirname(files.state), { recursive: true });
    await writeFile(
      files.state,
      JSON.stringify({
        version: 1,
        state: { goals: [goal], tasks: [], subtasks: [], meetings: [], questions: [] },
      }),
    );
    const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    await once(other, "spawn");
    await writeFile(
      files.lock,
      JSON.stringify({ pid: other.pid, session: 7, address: "there", open: true }),
    );
    await expect(open()).rejects.toThrow("Using openplan here brings it");

    const asked: string[] = [];
    const engine = await open({
      takeOver: async (holder) => {
        asked.push(holder.address);
        await rm(files.lock);
        return { goals: ["g1"], meetings: [] };
      },
    });
    other.kill();
    expect(asked).toEqual(["there"]);
    expect(engine.state.goals[0]?.status).toBe("active");
    expect(holderOf(files.lock)).toMatchObject({ session: 41, address: "here", open: true });
  });

  it("lets the team go at once as the process dies", async () => {
    const engine = await open();
    engine.abandon();
    opened.splice(0);
    await expect(stat(files.lock)).rejects.toThrow();
  });

  it("pauses what a session killed outright left active, its runs to go on in their sessions", async () => {
    const goal = { id: "g1", name: "Dice", slug: "dice", status: "active", createdAt: 0 };
    const subtask = {
      id: "s1",
      taskId: "t1",
      goalId: "g1",
      title: "Rules",
      description: "",
      acceptance: "",
      assignee: "glm",
      dependsOn: [],
      status: "running",
      createdAt: 0,
      progress: { done: 0, total: 0 },
      tokens: 0,
      session: "glm-1",
    };
    await mkdir(path.dirname(files.state), { recursive: true });
    await writeFile(
      files.state,
      JSON.stringify({
        version: 1,
        state: { goals: [goal], tasks: [], subtasks: [subtask], meetings: [], questions: [] },
      }),
    );
    const engine = await open();
    expect(engine.state.goals[0]?.status).toBe("paused");
    expect(engine.state.subtasks[0]).toMatchObject({ status: "pending", goOn: [{ why: "held" }] });
    // Written before the lock says the team is open (context.ts reads both).
    expect(await saved()).toMatchObject({ state: { goals: [{ status: "paused" }] } });
  });

  it("answers a question put to you and carries out the decision", async () => {
    const engine = await open();
    const goal = await engine.goals.start("Dice");
    await engine.goals.pause(goal.id);
    engine.state.tasks.push({
      id: "t1",
      goalId: goal.id,
      title: "Game",
      outcome: "",
      createdAt: 0,
      ownerAccepts: true,
    });
    const subtask = {
      id: "s1",
      taskId: "t1",
      goalId: goal.id,
      title: "Rules",
      description: "",
      acceptance: "",
      assignee: "glm",
      dependsOn: [],
      status: "done" as const,
      createdAt: 0,
      progress: { done: 0, total: 0 },
      tokens: 0,
    };
    engine.state.subtasks.push(subtask);
    engine.questions.openDecision(
      subtask,
      { kind: "delivery", options: ["accept", "revise"] },
      "Game",
    );
    const [question] = engine.state.questions;
    await expect(engine.answer(question?.id ?? "", { decision: "revise" })).rejects.toThrow(
      "doesn't fit",
    );
    await engine.answer(question?.id ?? "", { decision: "revise", note: "Bigger dice" });
    expect(question?.status).toBe("answered");
    expect(engine.state.subtasks[0]).toMatchObject({
      status: "pending",
      goOn: [{ why: "revised", note: "Bigger dice" }],
    });
  });

  it("won't open without a member's key, and keeps its team when the files can't be filled in", async () => {
    await expect(open({ env: {} })).rejects.toThrow("glm: Not set in the environment: GLM_KEY");
    const engine = await open();
    await teamFile("members/ann.md", "---\nrole: dev\nenv:\n  KEY: ${ANN_KEY}\n---\n");
    await expect(engine.reloadTeam()).rejects.toThrow("ann: Not set in the environment: ANN_KEY");
    expect(engine.team.members.map((m) => m.name)).toEqual(["glm"]);
    await teamFile("members/ann.md", "---\nrole: dev\n---\n");
    await teamFile("team.json", '{ "meetingSize": "small" }');
    await engine.reloadTeam();
    expect([engine.team.members.map((m) => m.name), engine.meetingSize]).toEqual([
      ["ann", "glm"],
      "small",
    ]);
  });
});

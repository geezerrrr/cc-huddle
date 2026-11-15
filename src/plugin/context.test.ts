import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dataFiles, repoFolder, type Holder } from "../engine/data.ts";
import { git, openRepository } from "../engine/git.ts";
import { teamFolder } from "../engine/team.ts";
import { sessionContext } from "./context.ts";

let dir: string;
let repo: string;
let data: string;
let user: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-context-")));
  repo = path.join(dir, "repo");
  data = path.join(dir, "openplan-inline");
  user = path.join(dir, "user-team");
  const me = {
    GIT_AUTHOR_NAME: "you",
    GIT_AUTHOR_EMAIL: "y@x",
    GIT_COMMITTER_NAME: "you",
    GIT_COMMITTER_EMAIL: "y@x",
  };
  await git({ cwd: dir }, ["init", "-q", "--initial-branch=main", repo]);
  await writeFile(path.join(repo, "README.md"), "hello\n");
  await git({ cwd: repo, env: me }, ["add", "-A"]);
  await git({ cwd: repo, env: me }, ["commit", "-q", "-m", "start"]);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** This test's session, as the hook's parent process. */
const SESSION = 41;

async function writeTeamAndGoal(status = "paused") {
  for (const [name, text] of [
    ["roles/dev.md", "---\ntitle: Developer\n---\n"],
    ["members/glm.md", "---\nrole: dev\n---\n"],
  ] as const) {
    const file = path.join(teamFolder(repo), name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  const { state } = dataFiles(repoFolder(data, await openRepository(repo)));
  await mkdir(path.dirname(state), { recursive: true });
  await writeFile(
    state,
    JSON.stringify({
      version: 1,
      state: {
        goals: [{ id: "g1", name: "Dice", slug: "dice", status, createdAt: 0 }],
        tasks: [],
        subtasks: [],
        meetings: [],
        questions: [],
      },
    }),
  );
}

/** Writes the team's lock as `holder` holds it. */
async function hold(holder: Holder) {
  await writeFile(
    dataFiles(repoFolder(data, await openRepository(repo))).lock,
    JSON.stringify(holder),
  );
}

describe("the session's context", () => {
  it("is where the team stands, once it has a goal", async () => {
    expect(await sessionContext(repo, data, user, SESSION)).toBeUndefined();
    await writeTeamAndGoal();
    expect(await sessionContext(repo, data, user, SESSION))
      .toBe(`openplan's team on this repository, as it stands:

Team: glm

Goal "Dice" [g1]: paused, on branch openplan/dice/main`);
    expect(await sessionContext(dir, data, user, SESSION)).toBeUndefined();
  });

  it("says what a session that ended without closing the team left going is paused as it opens", async () => {
    await writeTeamAndGoal("active");
    const left = "The session before ended without closing the team.";
    expect(await sessionContext(repo, data, user, SESSION)).toContain(left);
    // This session's server has the team, but hasn't opened it yet.
    await hold({ pid: process.pid, session: SESSION, address: "here", open: false });
    expect(await sessionContext(repo, data, user, SESSION)).toContain(left);
    // It has: the goal is active in this session (the context after /clear).
    await hold({ pid: process.pid, session: SESSION, address: "here", open: true });
    expect(await sessionContext(repo, data, user, SESSION)).not.toContain(left);
  });

  it("says when another session runs the team", async () => {
    await writeTeamAndGoal("active");
    await hold({ pid: process.pid, session: 42, address: "there", open: true });
    expect(await sessionContext(repo, data, user, SESSION)).toMatch(
      /^openplan's team on this repository runs in another Claude Code session \(pid 42\)/,
    );
  });

  it("is what the SessionStart hook adds", async () => {
    await writeTeamAndGoal();
    const hook = execFile(
      process.execPath,
      [
        "--experimental-transform-types",
        "--no-warnings",
        fileURLToPath(new URL("session-start.ts", import.meta.url)),
      ],
      { env: { PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: data, CLAUDE_CONFIG_DIR: dir } },
    );
    hook.stdin?.end(JSON.stringify({ hook_event_name: "SessionStart", cwd: repo }));
    let stdout = "";
    hook.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    await new Promise((resolve) => hook.once("close", resolve));
    expect(JSON.parse(stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: expect.stringContaining('Goal "Dice" [g1]') as string,
      },
    });
  });
});

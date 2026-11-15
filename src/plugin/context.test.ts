import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { goalFiles, goalsFolder, repoFolder } from "../shared/layout.ts";
import { git, openRepository } from "../engine/git.ts";
import { copyTeam, type TeamFiles } from "../engine/team.ts";
import { sessionContext } from "./context.ts";
import { type Holder } from "../engine/lock.ts";

let dir: string;
let repo: string;
let data: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-context-")));
  repo = path.join(dir, "repo");
  data = path.join(dir, "openplan-inline");
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

/** The files of the repository's goal `slug`. */
const filesOf = async (slug: string) =>
  goalFiles(path.join(goalsFolder(repoFolder(data, await openRepository(repo))), slug));

/** Writes a goal's folder: its state, and its copy of a team of one, glm. */
async function writeGoal(slug: string, status = "paused") {
  const files = await filesOf(slug);
  const team: TeamFiles = {
    team: {
      members: [{ name: "glm", role: { title: "Developer", duties: "" }, env: {} }],
      review: true,
    },
    settings: {},
    meetingSize: "discussion",
  };
  await copyTeam(files.team, team);
  await writeFile(
    files.state,
    JSON.stringify({
      version: 5,
      state: {
        goal: { name: slug, slug, status, createdAt: slug.length },
        tasks: [],
        subtasks: [],
        meetings: [],
        questions: [],
        tokens: {},
      },
    }),
  );
}

/** Writes a goal's lock as `holder` holds it. */
async function hold(slug: string, holder: Holder) {
  await writeFile((await filesOf(slug)).lock, JSON.stringify(holder));
}

describe("the session's context", () => {
  it("lists the repository's goals the session can take up, once there are any", async () => {
    expect(await sessionContext(repo, data, SESSION)).toBeUndefined();
    await writeGoal("dice");
    await writeGoal("chess", "archived");
    await writeGoal("go", "active");
    await hold("go", { pid: process.pid, session: 42, address: "there" });
    expect(await sessionContext(repo, data, SESSION))
      .toBe(`openplan: The repository's other goals, taken up here with /openplan resume:
  - go · no plan yet · in another session
  - dice · no plan yet · paused
  - chess · no plan yet · archived`);
    expect(await sessionContext(dir, data, SESSION)).toBeUndefined();
  });

  it("tells a session that runs a goal where it stands (after /clear)", async () => {
    await writeGoal("dice", "active");
    await hold("dice", { pid: process.pid, session: SESSION, address: "here" });
    expect(await sessionContext(repo, data, SESSION))
      .toBe(`This session runs openplan's goal "dice", as it stands:

Goal "dice": active, on branch openplan/dice/main
Team: glm`);
  });

  it("is what the SessionStart hook adds", async () => {
    await writeGoal("dice");
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
        additionalContext: expect.stringContaining("  - dice · no plan yet · paused") as string,
      },
    });
  });
});

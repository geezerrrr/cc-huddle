import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { goalFiles, goalsFolder, repoFolder } from "../shared/layout.ts";
import { git, openRepository } from "../engine/git.ts";
import { teamFolder } from "../engine/team.ts";
import { holderOf } from "../engine/lock.ts";

const SERVER = fileURLToPath(new URL("server.ts", import.meta.url));

let dir: string;
let repo: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "huddle-server-")));
  repo = path.join(dir, "repo");
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

/** A team of one, glm. */
async function writeTeam() {
  for (const [name, text] of [
    ["roles/dev.md", "---\ntitle: Developer\n---\n"],
    ["team.yaml", "members:\n  glm:\n    role: dev\n"],
  ] as const) {
    const file = path.join(teamFolder(repo), name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
}

/** The server as Claude Code starts it for a session in the repository: the test stands for the session. */
async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--experimental-transform-types", "--no-warnings", SERVER],
    env: {
      PATH: process.env.PATH ?? "",
      CLAUDE_PLUGIN_DATA: path.join(dir, "cc-huddle-inline"),
      CLAUDE_PROJECT_DIR: repo,
      // Your own team stays out of it.
      CLAUDE_CONFIG_DIR: path.join(dir, "claude"),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    return (result.content as { text: string }[])[0]?.text ?? "";
  };
  return { client, call };
}

/** The files of the repository's goal `slug`. */
const filesOf = async (slug: string) =>
  goalFiles(
    path.join(
      goalsFolder(repoFolder(path.join(dir, "cc-huddle-inline"), await openRepository(repo))),
      slug,
    ),
  );

describe("the MCP server", () => {
  it("runs no goal until the session starts one, and says why it can't", async () => {
    const { client, call } = await connect();
    expect(await call("status")).toContain("This session runs no goal");
    expect(await call("start_goal", { name: "Dice" })).toContain("The team has no members");
    await writeTeam();
    expect(await call("start_goal", { name: "Dice" })).toContain("huddle/dice/main");
    expect((await call("status")).replace(/checked out in [^)]+/, "checked out in …")).toContain(
      'Goal "Dice": active, on branch huddle/dice/main (cut from main, checked out in …); review on, discussion meetings, parallel off\nTeam: glm',
    );
    expect(await call("start_goal", { name: "Chess" })).toContain("a session runs one goal");
    await client.close();
  });

  it("hands its goal over to a session that takes it up, which goes on with it", async () => {
    await writeTeam();
    const files = await filesOf("dice");
    const saved = async () =>
      (JSON.parse(await readFile(files.state, "utf8")) as { state: { goal: unknown } }).state.goal;
    const first = await connect();
    await first.call("start_goal", { name: "Dice" });
    const second = await connect();
    expect(await second.call("status")).toContain("Dice · no plan yet · in another session");
    const holder = holderOf(files.lock)?.pid;
    expect(await second.call("resume_goal", { goal: "dice" })).toBe('Resumed "Dice".');
    expect(holderOf(files.lock)?.pid).not.toBe(holder);
    expect(await saved()).toMatchObject({ name: "Dice", status: "active" });
    expect(await first.call("status")).toContain(
      'The goal "Dice" moved to another Claude Code session',
    );
    // The one that let go ends without touching the goal.
    await first.client.close();
    expect(holderOf(files.lock)).toBeDefined();
    await second.client.close();
    expect(await saved()).toMatchObject({ name: "Dice", status: "paused" });
    // Two servers start, slow while the other test files run alongside.
  }, 20_000);

  it("closes its goal as the session ends: paused, its state written, the lock let go", async () => {
    await writeTeam();
    const { client, call } = await connect();
    expect(await call("start_goal", { name: "Dice" })).toContain("huddle/dice/main");
    await client.close();
    const files = await filesOf("dice");
    await expect(stat(files.lock)).rejects.toThrow();
    expect(JSON.parse(await readFile(files.state, "utf8"))).toMatchObject({
      state: { goal: { name: "Dice", status: "paused" } },
    });
  });
});

import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dataFiles, holderOf, repoFolder } from "../engine/data.ts";
import { git, openRepository } from "../engine/git.ts";
import { teamFolder } from "../engine/team.ts";

const SERVER = fileURLToPath(new URL("server.ts", import.meta.url));

let dir: string;
let repo: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-server-")));
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
    ["members/glm.md", "---\nrole: dev\n---\n"],
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
      CLAUDE_PLUGIN_DATA: path.join(dir, "openplan-inline"),
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

describe("the MCP server", () => {
  it("says why there is no team, and opens it once its files are there", async () => {
    const { client, call } = await connect();
    expect(await call("status")).toContain("The team has no members");
    await writeTeam();
    expect(await call("status")).toBe("Team: glm");
    await client.close();
  });

  it("goes to the session that uses it, which goes on with what the other one had going", async () => {
    await writeTeam();
    const files = dataFiles(
      repoFolder(path.join(dir, "openplan-inline"), await openRepository(repo)),
    );
    const goals = async () =>
      (JSON.parse(await readFile(files.state, "utf8")) as { state: { goals: unknown[] } }).state
        .goals;
    const first = await connect();
    expect(await first.call("start_goal", { name: "Dice" })).toContain("openplan/dice/main");
    const second = await connect();
    expect(await second.call("status")).toContain("Dice");
    expect(await goals()).toMatchObject([{ name: "Dice", status: "active" }]);
    const taker = holderOf(files.lock)?.pid;
    expect(await first.call("status")).toContain("Dice");
    expect(holderOf(files.lock)?.pid).not.toBe(taker);
    // The one that let go ends without touching the team.
    await second.client.close();
    expect(holderOf(files.lock)).toBeDefined();
    await first.client.close();
    expect(await goals()).toMatchObject([{ name: "Dice", status: "paused" }]);
  });

  it("closes the team as the session ends: its goals paused, its state written, the lock let go", async () => {
    await writeTeam();
    const { client, call } = await connect();
    expect(await call("start_goal", { name: "Dice" })).toContain("openplan/dice/main");
    await client.close();

    const files = dataFiles(
      repoFolder(path.join(dir, "openplan-inline"), await openRepository(repo)),
    );
    await expect(stat(files.lock)).rejects.toThrow();
    expect(JSON.parse(await readFile(files.state, "utf8"))).toMatchObject({
      state: { goals: [{ name: "Dice", status: "paused" }] },
    });
  });
});

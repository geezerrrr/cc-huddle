import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../engine/engine.ts";
import { git } from "../engine/git.ts";
import { runSubtask, type RunOutcome } from "../engine/run.ts";
import { teamFolder } from "../engine/team.ts";
import { addTools } from "./tools.ts";

vi.mock("../engine/run.ts", () => ({ runSubtask: vi.fn() }));

const ME = {
  GIT_AUTHOR_NAME: "you",
  GIT_AUTHOR_EMAIL: "you@example.com",
  GIT_COMMITTER_NAME: "you",
  GIT_COMMITTER_EMAIL: "you@example.com",
};

let dir: string;
let engine: Engine;
let client: Client;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-tools-")));
  const repo = path.join(dir, "repo");
  await git({ cwd: dir }, ["init", "-q", "--initial-branch=main", repo]);
  await writeFile(path.join(repo, "README.md"), "hello\n");
  await git({ cwd: repo, env: ME }, ["add", "-A"]);
  await git({ cwd: repo, env: ME }, ["commit", "-q", "-m", "start"]);
  for (const [name, text] of [
    ["roles/dev.md", "---\ntitle: Developer\n---\nBuild it."],
    ["members/glm.md", "---\nrole: dev\n---\n"],
    ["members/sonnet.md", "---\nrole: dev\n---\n"],
  ] as const) {
    const file = path.join(teamFolder(repo), name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  engine = await Engine.open({
    cwd: repo,
    dataFolder: path.join(dir, "openplan-inline"),
    env: {},
    host: { changed: vi.fn(), recorder: () => ({}), speech: () => ({}), failed: vi.fn() },
  });
  // A run goes on until it is stopped.
  vi.mocked(runSubtask).mockImplementation(
    ({ signal }) =>
      new Promise<RunOutcome>((resolve) => {
        const stopped = () => {
          resolve({ status: "stopped", tokens: 0 });
        };
        if (signal.aborted) stopped();
        else signal.addEventListener("abort", stopped);
      }),
  );
  const server = new McpServer({ name: "openplan", version: "0.0.0" });
  addTools(server, () => Promise.resolve(engine));
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
});

afterEach(async () => {
  await client.close();
  await engine.close();
  await rm(dir, { recursive: true, force: true });
});

/** Calls a tool: what it said, and whether that is an error. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as { text: string }[];
  return { text: first?.text ?? "", error: result.isError === true };
}

describe("tools", () => {
  it("start a goal, assign work, pass a message, stop it, and tell where it stands", async () => {
    expect(await call("start_goal", { name: "Dice" })).toMatchObject({
      text: expect.stringContaining("on branch openplan/dice/main") as string,
    });
    const assigned = await call("assign", {
      goal: "dice",
      assignee: "glm",
      title: "Rules",
      description: "Two dice",
    });
    expect(assigned.text).toMatch(/^Assigned "Rules" \[.+\] to glm\.$/);
    const [subtask] = engine.state.subtasks;
    expect(subtask?.status).toBe("running");
    const id = subtask?.id ?? "";

    expect((await call("message", { subtask: id, text: "Use d6" })).text).toBe("Passed on.");
    await vi.waitFor(() => {
      expect(runSubtask).toHaveBeenCalledTimes(2);
    });
    expect((await call("subtask_action", { subtask: id, action: "stop" })).text).toBe(
      '"Rules" is stopped now.',
    );
    expect(await call("subtask_action", { subtask: id, action: "stop" })).toEqual({
      text: '"Rules" can\'t stop while stopped',
      error: true,
    });
    expect((await call("status")).text).toContain(`- Rules [${id}], glm: stopped`);
  });

  it("show, change and approve a plan under review", async () => {
    const goal = await engine.goals.start("Dice");
    const subtask = {
      key: "a",
      title: "Rules",
      description: "",
      assignee: "glm",
      dependsOn: [],
      acceptance: "",
    };
    engine.state.meetings.push({
      id: "m1",
      goalId: goal.id,
      agenda: "Dice",
      size: "small",
      participants: ["glm"],
      host: "glm",
      status: "review",
      turns: [],
      plan: {
        summary: "Dice",
        markdown: "# Dice",
        tasks: [{ title: "Game", outcome: "", subtasks: [subtask] }],
      },
      tokens: 0,
      createdAt: 0,
    });
    const shown = JSON.parse((await call("show_plan", { meeting: "m1" })).text) as {
      tasks: { subtasks: { assignee: string; depends_on: string[] }[] }[];
    };
    expect(shown.tasks[0]?.subtasks[0]).toMatchObject({ assignee: "glm", depends_on: [] });

    const to = (assignee: string) => ({
      ...shown,
      tasks: [{ ...shown.tasks[0], subtasks: [{ ...shown.tasks[0]?.subtasks[0], assignee }] }],
    });
    expect((await call("change_plan", { meeting: "m1", plan: to("ann") })).error).toBe(true);
    await call("change_plan", { meeting: "m1", plan: to("sonnet") });
    expect((await call("approve_plan", { meeting: "m1" })).text).toBe(
      "Approved: 1 subtask goes to work.",
    );
    expect(engine.state.subtasks).toMatchObject([{ title: "Rules", assignee: "sonnet" }]);
  });

  it("find a goal by its name only when that is enough", async () => {
    expect(await call("goal_action", { goal: "dice", action: "pause" })).toEqual({
      text: 'There is no goal "dice"',
      error: true,
    });
    await engine.goals.start("Dice");
    await engine.goals.start("Dice");
    expect((await call("goal_action", { goal: "Dice", action: "pause" })).text).toBe(
      'More than one goal is called "Dice": give its id',
    );
  });
});

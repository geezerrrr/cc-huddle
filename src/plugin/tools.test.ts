import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { git } from "../engine/git.ts";
import { runSubtask, type RunOutcome } from "../engine/run.ts";
import { teamFolder } from "../engine/team.ts";
import { Session } from "./session.ts";
import { addTools } from "./tools.ts";
import type { Core } from "../engine/core.ts";
import type { Engine } from "../engine/engine.ts";
import type { Questions } from "../engine/questions.ts";
import type { Records } from "../engine/records.ts";
import type { Scheduler } from "../engine/scheduler.ts";

/** The engine's own state and parts, which a test sets work up through. */
const inside = (engine: Engine) =>
  engine as unknown as {
    core: Core;
    parts: { questions: Questions; scheduler: Scheduler; records: Records };
  };

vi.mock("../engine/run.ts", () => ({ runSubtask: vi.fn() }));

const ME = {
  GIT_AUTHOR_NAME: "you",
  GIT_AUTHOR_EMAIL: "you@example.com",
  GIT_COMMITTER_NAME: "you",
  GIT_COMMITTER_EMAIL: "you@example.com",
};

let dir: string;
let session: Session;
let client: Client;

/** The session's goal, which a test has started. */
const goal = () => session.goal;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "huddle-tools-")));
  const repo = path.join(dir, "repo");
  await git({ cwd: dir }, ["init", "-q", "--initial-branch=main", repo]);
  await writeFile(path.join(repo, "README.md"), "hello\n");
  await git({ cwd: repo, env: ME }, ["add", "-A"]);
  await git({ cwd: repo, env: ME }, ["commit", "-q", "-m", "start"]);
  for (const [name, text] of [
    ["roles/dev.md", "---\ntitle: Developer\n---\nBuild it."],
    ["team.yaml", "members:\n  glm:\n    role: dev\n  sonnet:\n    role: dev\n"],
  ] as const) {
    const file = path.join(teamFolder(repo), name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  const server = new McpServer({ name: "huddle", version: "0.0.0" });
  session = new Session(
    {
      cwd: repo,
      dataFolder: path.join(dir, "cc-huddle-inline"),
      session: 41,
      address: "here",
      takeOver: () => Promise.reject(new Error("not asked")),
      sessionMode: () => undefined,
      plugins: ["cc-huddle@inline"],
      userTeam: path.join(dir, "user-team"),
      env: {},
      failed: vi.fn(),
    },
    () => Promise.resolve("claude"),
    (engine) => {
      if (engine) listMembers(engine.team);
    },
  );
  const listMembers = addTools(server, session);
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
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
});

afterEach(async () => {
  await client.close();
  await session.close();
  await rm(dir, { recursive: true, force: true });
});

/** Calls a tool: what it said, and whether that is an error. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as { text: string }[];
  return { text: first?.text ?? "", error: result.isError === true };
}

describe("tools", () => {
  it("load the four a goal starts with upfront, and leave the rest deferred", async () => {
    const { tools } = await client.listTools();
    const upfront = tools.filter((tool) => tool._meta?.["anthropic/alwaysLoad"] === true);
    expect(upfront.map((tool) => tool.name).sort()).toEqual([
      "assign",
      "hold_meeting",
      "recommend",
      "start_goal",
    ]);
  });

  it("name members only from the goal's team, each with their role", async () => {
    const told = vi.fn();
    client.setNotificationHandler(ToolListChangedNotificationSchema, told);
    await call("start_goal", { name: "Dice" });
    await vi.waitFor(() => {
      expect(told).toHaveBeenCalled();
    });
    const { tools } = await client.listTools();
    const assign = tools.find((t) => t.name === "assign")?.inputSchema.properties?.assignee;
    expect(assign).toMatchObject({
      enum: ["glm", "sonnet"],
      description: "One of the team: glm (Developer), sonnet (Developer)",
    });
    expect(
      await call("assign", { assignee: "ann", title: "Rules", description: "" }),
    ).toMatchObject({ error: true, text: expect.stringContaining('"glm"') as string });
  });

  it("start a goal, assign work, stop it, and tell where it stands", async () => {
    expect(await call("start_goal", { name: "Dice" })).toMatchObject({
      text: expect.stringContaining("on branch huddle/dice/main") as string,
    });
    const assigned = await call("assign", {
      assignee: "glm",
      title: "Rules",
      description: "Two dice",
    });
    expect(assigned.text).toMatch(/^Assigned "Rules" \[.+\] to glm\.$/);
    const [subtask] = goal().work.subtasks;
    expect(subtask?.status).toBe("running");
    const id = subtask?.id ?? "";

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
    await session.start("Dice");
    const subtask = {
      key: "a",
      title: "Rules",
      description: "",
      assignee: "glm",
      dependsOn: [],
      acceptance: "",
    };
    inside(goal()).core.state.meetings.push({
      id: "m1",
      agenda: "Dice",
      size: "small",
      participants: ["glm"],
      status: "review",
      turns: [],
      plan: {
        summary: "Dice",
        markdown: "# Dice",
        tasks: [{ title: "Game", outcome: "", ownerAccepts: true, subtasks: [subtask] }],
      },
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
    expect(goal().work.subtasks).toMatchObject([{ title: "Rules", assignee: "sonnet" }]);
  });

  it("act on the session's one goal: another starts only once it is paused, and it is deleted once archived", async () => {
    expect(await call("goal_action", { action: "pause" })).toEqual({
      text: "This session runs no goal: start one (start_goal), or the user takes one up with /huddle resume.",
      error: true,
    });
    await call("start_goal", { name: "Dice" });
    expect((await call("start_goal", { name: "Chess" })).text).toContain(
      'This session\'s goal "Dice" is under way',
    );
    await call("goal_action", { action: "pause" });
    await call("start_goal", { name: "Chess" });
    expect((await call("status")).text).toContain("  - Dice · no plan yet · paused");
    await call("goal_action", { action: "archive" });
    expect((await call("goal_action", { action: "delete" })).text).toBe(
      'The goal "Chess": delete done.',
    );
    expect((await call("status")).text).toContain("This session runs no goal");
  });
});

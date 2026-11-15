import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../engine/engine.ts";
import { git } from "../engine/git.ts";
import { teamFolder } from "../engine/team.ts";
import type { Question } from "../engine/types.ts";
import type { OpenplanView } from "../../plugin/types/index.d.ts";
import { askToLetGo, servePane, type PaneServer } from "./pane-server.ts";
import { addPaneTools } from "./pane-tools.ts";

let dir: string;
let engine: Engine;
let client: Client;
let pane: PaneServer;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-pane-")));
  const repo = path.join(dir, "repo");
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
  for (const [name, text] of [
    ["roles/dev.md", "---\ntitle: Developer\n---\n"],
    ["members/glm.md", "---\nrole: dev\nmodel: glm-5\n---\n"],
  ] as const) {
    const file = path.join(teamFolder(repo), name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  engine = await Engine.open({
    cwd: repo,
    dataFolder: path.join(dir, "openplan-inline"),
    claude: "claude",
    session: 41,
    address: "here",
    sessionMode: () => undefined,
    plugin: "openplan@inline",
    userTeam: path.join(dir, "user-team"),
    env: {},
    teamRead: vi.fn(),
    failed: vi.fn(),
  });
  const server = new McpServer({ name: "openplan", version: "0.0.0" });
  pane = await servePane(
    () => Promise.resolve(engine),
    () => engine.close(),
  );
  addPaneTools(server, () => Promise.resolve(engine), pane);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
});

afterEach(async () => {
  await client.close();
  pane.close();
  await engine.close();
  await rm(dir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content as { text: string }[];
  return { text: first?.text ?? "", error: result.isError === true };
}

/** Asks the pane's socket, at the address the `pane` tool gives: its status and body. */
async function ask(path_: string, body: string) {
  const socketPath = (await call("pane")).text;
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const sent = request({ socketPath, path: path_, method: "POST" }, (response) => {
      let text = "";
      response.setEncoding("utf8").on("data", (chunk: string) => (text += chunk));
      response.on("end", () => {
        resolve({ status: response.statusCode ?? 0, text });
      });
    });
    sent.once("error", reject).end(body);
  });
}

const view = async (args: Record<string, unknown> = {}) =>
  JSON.parse((await ask("/view", JSON.stringify(args))).text) as OpenplanView;

describe("the pane's socket and tools", () => {
  it("let the team go to a session taking it over, and say what that stopped", async () => {
    const goal = await engine.goals.start("Dice");
    expect(await askToLetGo(pane.address)).toEqual({ goals: [goal.id], meetings: [] });
    expect(engine.state.goals[0]?.status).toBe("paused");
  });

  it("pause the goal under way, and resume the one picked", async () => {
    const dice = await engine.goals.start("Dice");
    expect((await call("pause_goal")).text).toBe('Paused "Dice".');
    expect((await view()).team?.paused).toEqual([{ id: dice.id, label: "Dice · no plan yet" }]);
    expect((await call("pause_goal")).text).toBe("No goal is active.");
    expect((await call("resume_goal", { goal: dice.id })).text).toBe("Resumed.");
    expect(dice.status).toBe("active");
  });

  it("serve only the view and the release, and say why an ask doesn't fit", async () => {
    expect((await ask("/answer", "{}")).status).toBe(404);
    expect(await ask("/view", '{ "revision": "one" }')).toMatchObject({ status: 409 });
    const { address } = pane;
    pane.close();
    expect(existsSync(address)).toBe(false);
  });

  it("give the team only when it changed since the pane's revision", async () => {
    const first = await view();
    expect(first.team).toEqual({
      tasks: [],
      members: [{ name: "glm", role: "Developer", model: "glm-5", doing: "free", tokens: 0 }],
      needs: [],
      milestones: [],
      prompts: [],
      paused: [],
    });
    expect(await view({ revision: first.revision })).toEqual({ revision: first.revision });
    await engine.goals.start("Dice");
    const next = await view({ revision: first.revision });
    expect(next.revision).toBeGreaterThan(first.revision);
    expect(next.team?.band).toBe("idle");
  });

  it("follow a subtask's record from where the pane read up to", async () => {
    engine.records.recorder("s1").block?.({ kind: "text", text: "Done." });
    await engine.records.flush();
    const { record } = await view({ record: { subtask: "s1", from: 0 } });
    expect(record).toMatchObject({
      subtask: "s1",
      entries: [{ kind: "text", text: "Done." }],
      live: { running: [] },
    });
    expect((await view({ record: { subtask: "s1", from: record?.next } })).record?.entries).toEqual(
      [],
    );
  });

  it("answer what waits on you as it was pressed, and refuse what doesn't fit", async () => {
    const question: Question = {
      id: "q1",
      from: "glm",
      text: "Which board?",
      kind: "choices",
      choices: [
        {
          question: "Which board?",
          header: "Board",
          options: [{ label: "Grid", description: "" }],
          multiSelect: false,
        },
      ],
      status: "open",
      createdAt: 0,
    };
    engine.state.questions.push(question);
    expect(await call("answer", { question: "q1", option: "once" })).toEqual({
      text: "That answer doesn't fit the question.",
      error: true,
    });
    expect(await call("answer", { question: "q1", picks: ["Grid"] })).toEqual({
      text: "Answered q1.",
      error: false,
    });
    expect(question.status).toBe("answered");
  });
});

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { git } from "../engine/git.ts";
import { teamFolder } from "../engine/team.ts";
import type { Question } from "../engine/types.ts";
import type { OpenplanView } from "../../plugin/types/index.d.ts";
import { askToLetGo, servePane, type PaneServer } from "./pane-server.ts";
import { addPaneTools } from "./pane-tools.ts";
import { Session } from "./session.ts";

let dir: string;
let session: Session;
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
  const server = new McpServer({ name: "openplan", version: "0.0.0" });
  pane = await servePane(() => session);
  session = new Session(
    {
      cwd: repo,
      dataFolder: path.join(dir, "openplan-inline"),
      session: 41,
      address: pane.address,
      // Another session of the test, at the same socket.
      takeOver: (holder, slug) => askToLetGo(holder.address, slug),
      sessionMode: () => undefined,
      plugins: ["openplan@inline"],
      userTeam: path.join(dir, "user-team"),
      env: {},
      failed: vi.fn(),
    },
    () => Promise.resolve("claude"),
    vi.fn(),
  );
  addPaneTools(server, session, pane);
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientSide);
});

afterEach(async () => {
  await client.close();
  pane.close();
  await session.close();
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
  it("let the session's goal go to a session taking it up, and say what that stopped", async () => {
    await session.start("Dice");
    expect(await askToLetGo(pane.address, "chess")).toEqual({ meetings: [] });
    expect(session.current?.state.goal.status).toBe("active");
    expect(await askToLetGo(pane.address, "dice")).toEqual({ meetings: [] });
    expect(session.current).toBeUndefined();
    expect((await view()).team?.resumable).toEqual([
      { slug: "dice", label: "Dice · no plan yet · paused" },
    ]);
  });

  it("take up the goal picked, and refuse while the session's own is under way", async () => {
    const dice = await session.start("Dice");
    await dice.goals.pause();
    expect((await view()).team?.resumable).toEqual([
      { slug: "dice", label: "Dice · no plan yet · paused, in this session" },
    ]);
    expect((await call("resume_goal", { goal: "dice" })).text).toBe('Resumed "Dice".');
    expect(session.current?.state.goal.status).toBe("active");
    await dice.goals.pause();
    const chess = await session.start("Chess");
    expect((await view()).team?.resumeRefused).toContain('"Chess" is under way');
    expect((await call("resume_goal", { goal: "dice" })).text).toContain('"Chess" is under way');
    await chess.goals.pause();
    expect((await call("resume_goal", { goal: "dice" })).text).toBe('Resumed "Dice".');
    expect((await view()).team?.resumable).toEqual([
      { slug: "chess", label: "Chess · no plan yet · paused" },
    ]);
  });

  it("hand the session a task for the team, with the goal it runs and its team", async () => {
    expect((await call("hand_off", { task: "Add a scoreboard" })).text).toBe(
      "The user hands this to openplan's team: take it on as openplan's team skill says, and don't do any of it yourself.\n\nAdd a scoreboard\n\nThis session runs no goal yet.",
    );
    await session.start("Dice");
    expect((await call("hand_off", { task: "Add a scoreboard" })).text).toContain(
      'This session runs the goal "Dice", under way. The team: glm (Developer).',
    );
  });

  it("take up only a goal named by its slug", async () => {
    expect(await call("resume_goal", { goal: "../dice" })).toMatchObject({ error: true });
  });

  it("read the repository's goals again every so often as the pane polls, and at once on a look", async () => {
    const goals = vi.spyOn(session, "goals");
    const { revision } = await view();
    await view({ revision });
    await view({ revision });
    expect(goals).toHaveBeenCalledTimes(1);
    await view();
    expect(goals).toHaveBeenCalledTimes(2);
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
      noGoal:
        "This session runs no goal. Hand the team a task with /openplan <task>, or take a goal up with /openplan resume.",
      tasks: [],
      members: [],
      needs: [],
      milestones: [],
      prompts: [],
      resumable: [],
    });
    expect(await view({ revision: first.revision })).toEqual({ revision: first.revision });
    await session.start("Dice");
    const next = await view({ revision: first.revision });
    expect(next.revision).toBeGreaterThan(first.revision);
    expect(next.team).toMatchObject({
      goal: { name: "Dice", slug: "dice" },
      band: "idle",
      members: [{ name: "glm", role: "Developer", model: "glm-5", doing: "free", tokens: 0 }],
    });
  });

  it("follow a subtask's record from where the pane read up to", async () => {
    const engine = await session.start("Dice");
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
    };
    (await session.start("Dice")).state.questions.push(question);
    expect(await call("answer", { question: "q1", option: "once" })).toEqual({
      text: "That answer doesn't fit the question.",
      error: true,
    });
    expect(await call("answer", { question: "q1", picks: ["Grid"] })).toEqual({
      text: "Answered q1.",
      error: false,
    });
    expect(session.current?.state.questions).toEqual([]);
  });
});

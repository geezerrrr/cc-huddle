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
import { DECISIONS, type DecisionQuestion, type Subtask } from "../engine/types.ts";
import type { OpenplanAsk, OpenplanView } from "../../plugin/types/index.d.ts";
import { askToLetGo, servePane, type PaneServer } from "./pane-server.ts";
import { addPaneTools } from "./pane-tools.ts";
import { Session } from "./session.ts";
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

const view = async (args: OpenplanAsk = {}) =>
  JSON.parse((await ask("/view", JSON.stringify(args))).text) as OpenplanView;

describe("the pane's socket and tools", () => {
  it("let the session's goal go to a session taking it up, and say what that stopped", async () => {
    await session.start("Dice");
    expect(await askToLetGo(pane.address, "chess")).toEqual({ meetings: [] });
    expect(session.current?.work.goal.status).toBe("active");
    expect(await askToLetGo(pane.address, "dice")).toEqual({ meetings: [] });
    expect(session.current).toBeUndefined();
    // Nothing listening: the server that held it has ended.
    expect(
      await askToLetGo(path.join(path.dirname(pane.address), "gone.sock"), "dice"),
    ).toBeUndefined();
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
    expect(session.current?.work.goal.status).toBe("active");
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
      "The user hands this to openplan's team: take it on as openplan's team skill says.\n\nAdd a scoreboard\n\nThis session runs no goal yet.",
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
    expect(await ask("/view", '{ "revision": "one" }')).toMatchObject({ status: 400 });
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
      opened: 0,
      resumeRefused: "No goal to resume.",
      pauseRefused:
        "This session runs no goal. Hand the team a task with /openplan <task>, or take a goal up with /openplan resume.",
      typedAnswersNone: "openplan: what you typed answers none of it; it waits in Needs you",
    });
    expect(await view({ revision: first.revision })).toEqual({ revision: first.revision });
    await session.start("Dice");
    const next = await view({ revision: first.revision });
    expect(next.revision).toBeGreaterThan(first.revision);
    expect(next.team).toMatchObject({
      opened: 1,
      band: "idle",
      members: [
        { name: "glm", line: "Developer · glm-5 · 0 tokens", doing: "free", followable: false },
      ],
    });
  });

  it("follow a member's record from where the pane read up to, and onto their new work", async () => {
    const engine = await session.start("Dice");
    const { records } = inside(engine).parts;
    const started = (id: string, at: number): Subtask => ({
      id,
      taskId: "t1",
      title: id,
      description: "",
      acceptance: "",
      assignee: "glm",
      dependsOn: [],
      status: "done",
      progress: { done: 0, total: 0 },
      startedAt: at,
    });
    inside(engine).core.state.subtasks.push(started("s1", 1));
    records.recorder("s1").block?.({ kind: "text", text: "Done." });
    await records.flush();
    const { record } = await view({ record: { member: "glm" } });
    expect(record).toMatchObject({
      subtask: "s1",
      entries: [{ kind: "text", text: "Done." }],
      live: { running: [] },
    });
    const read = { subtask: "s1", next: record?.next ?? 0 };
    expect((await view({ record: { member: "glm", read } })).record?.entries).toEqual([]);
    inside(engine).core.state.subtasks.push(started("s2", 2));
    records.recorder("s2").block?.({ kind: "text", text: "Next." });
    await records.flush();
    expect((await view({ record: { member: "glm", read } })).record).toMatchObject({
      subtask: "s2",
      entries: [{ kind: "text", text: "Next." }],
    });
  });

  it("answer what waits on you as it was pressed, and refuse what doesn't fit", async () => {
    const question: DecisionQuestion = {
      id: "q1",
      subtaskId: "s1",
      from: "glm",
      text: "Board",
      kind: "decision",
      decision: DECISIONS.delivery(),
    };
    inside(await session.start("Dice")).core.state.questions.push(question);
    expect(
      await call("answer", { question: "q1", answer: { kind: "option", option: "once" } }),
    ).toEqual({
      text: "That answer doesn't fit the question.",
      error: true,
    });
    expect(
      await call("answer", { question: "q1", answer: { kind: "option", option: "accept" } }),
    ).toEqual({
      text: "Answered q1.",
      error: false,
    });
    expect(session.current?.work.questions).toEqual([]);
  });
});

import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Meeting, TeamState } from "../engine/types.ts";
import { NewForYou, wakeSession } from "./wake.ts";

let dir: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-wake-")));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("wakeSession", () => {
  it("posts to the session's inbox as a message from another session, with its token", async () => {
    const socket = path.join(dir, "inbox.sock");
    const received: string[] = [];
    const inbox: Server = createServer((connection) => {
      connection.setEncoding("utf8").on("data", (chunk: string) => received.push(chunk));
    });
    await new Promise<void>((resolve) => inbox.listen(socket, resolve));
    await wakeSession("A plan is ready", {
      CLAUDE_CODE_MESSAGING_SOCKET: socket,
      CLAUDE_CODE_MESSAGING_TOKEN: "t0k",
    });
    inbox.close();
    expect(
      received
        .join("")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown),
    ).toEqual([
      { type: "auth", token: "t0k" },
      { type: "user", message: { role: "user", content: "A plan is ready" } },
    ]);
  });

  it("has no one to wake without a socket", async () => {
    await expect(wakeSession("A plan is ready", {})).resolves.toBeUndefined();
  });
});

describe("NewForYou", () => {
  const meeting = (id: string, status: Meeting["status"]): Meeting => ({
    id,
    goalId: "g1",
    agenda: "Dice",
    size: "small",
    participants: ["glm"],
    host: "glm",
    status,
    turns: [],
    plan: { summary: "A dice game", markdown: "", tasks: [] },
    tokens: 0,
    createdAt: 0,
  });
  const state = (): TeamState => ({
    goals: [],
    tasks: [],
    subtasks: [],
    meetings: [meeting("m1", "review")],
    questions: [],
  });

  it("tells each plan out for review and each task done once, not what waited before", () => {
    const now = state();
    const news = new NewForYou(now);
    expect(news.news(now)).toEqual([]);
    const m2 = meeting("m2", "running");
    now.meetings.push(m2);
    expect(news.news(now)).toEqual([]);
    m2.status = "review";
    expect(news.news(now)).toEqual([
      'openplan: the meeting [m2] on "Dice" has a plan: A dice game. Show it to the user with show_plan, and ask whether to approve it, change it, or cancel it.',
    ]);
    expect(news.news(now)).toEqual([]);

    now.subtasks.push({
      id: "s1",
      taskId: "t1",
      goalId: "g1",
      title: "Rules",
      description: "",
      acceptance: "",
      assignee: "glm",
      dependsOn: [],
      status: "done",
      createdAt: 0,
      progress: { done: 0, total: 0 },
      tokens: 0,
      delivery: { summary: "Two dice, a reroll.", files: [], at: 0 },
    });
    now.questions.push({
      id: "q1",
      subtaskId: "s1",
      from: "glm",
      text: "Game",
      status: "open",
      createdAt: 0,
      kind: "decision",
      decision: { kind: "delivery", options: ["accept", "revise"] },
    });
    expect(news.news(now)).toEqual([
      `openplan: the task "Game" is done [q1], merged into its goal's branch:
- Rules, by glm: Two dice, a reroll.
Tell the user what was done, and ask whether to accept it or send it back with what to change (decide).`,
    ]);
  });
});

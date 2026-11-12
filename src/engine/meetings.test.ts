import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Core } from "./core.ts";
import { git, goalFolder, openRepository } from "./git.ts";
import { Meetings, nextMove } from "./meetings.ts";
import type { Scheduler } from "./scheduler.ts";
import { askOnce, type Reply } from "./turns.ts";
import type { Meeting, MeetingTurn, Member } from "./types.ts";

// Meeting tools as plain handlers, so a scripted turn can call them.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (name: string, _: string, __: unknown, handler: unknown) => ({ name, handler }),
  createSdkMcpServer: (server: unknown) => server,
}));
vi.mock("./turns.ts", () => ({ askOnce: vi.fn() }));

const member = (name: string, title: string): Member => ({
  name,
  role: { id: title, title, duties: "" },
  env: {},
});

let dir: string;
let core: Core;
let meetings: Meetings;
const pump = vi.fn();

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-meetings-")));
  const repo = path.join(dir, "repo");
  await git({ cwd: dir }, ["init", "-q", "--initial-branch=main", repo]);
  await writeFile(path.join(repo, "README.md"), "hello\n");
  const me = {
    GIT_AUTHOR_NAME: "you",
    GIT_AUTHOR_EMAIL: "y@x",
    GIT_COMMITTER_NAME: "you",
    GIT_COMMITTER_EMAIL: "y@x",
  };
  await git({ cwd: repo, env: me }, ["add", "-A"]);
  await git({ cwd: repo, env: me }, ["commit", "-q", "-m", "start"]);
  core = {
    state: {
      goals: [{ id: "g1", name: "Dice", slug: "dice", status: "active", createdAt: 0 }],
      tasks: [],
      subtasks: [],
      meetings: [],
      questions: [],
    },
    team: { members: [member("sonnet", "Programmer"), member("glm", "UI designer")], review: true },
    places: { repo: await openRepository(repo), root: path.join(dir, "data") },
    changed: vi.fn(),
    allowAlways: vi.fn(),
    options: (m, kind, cwd) => Promise.resolve({ cwd, model: `${m.name}/${kind}` }),
    recorder: () => ({}),
    speech: () => ({}),
  };
  meetings = new Meetings(core, { pump } as unknown as Scheduler);
  vi.mocked(askOnce).mockReset();
});

afterEach(async () => {
  await meetings.close();
  await rm(dir, { recursive: true, force: true });
});

type Ask = Parameters<typeof askOnce>[0];

/** Calls the turn's meeting tool, as the model would. */
async function call(ask: Ask, args: Record<string, unknown>) {
  const server = ask.options.mcpServers?.openplan as unknown as {
    tools: { handler: (a: Record<string, unknown>) => Promise<unknown> }[];
  };
  await server.tools[0]?.handler(args);
}

const plan = {
  summary: "A dice game in a week",
  plan_markdown: "# Plan",
  tasks: [
    {
      title: "Game",
      outcome: "Playable",
      subtasks: [
        {
          key: "a",
          title: "Rules",
          description: "",
          assignee: "sonnet",
          depends_on: [],
          acceptance: "",
        },
        {
          key: "b",
          title: "Board",
          description: "",
          assignee: "glm",
          depends_on: ["a"],
          acceptance: "",
        },
      ],
    },
  ],
};

/** Turns as the members would take them: `script` says what each kind of turn does. */
function scripted(script: Partial<Record<"hand" | "steer", (ask: Ask) => Promise<string>>> = {}) {
  let n = 0;
  vi.mocked(askOnce).mockImplementation(async (ask): Promise<Reply> => {
    n += 1;
    const reply = (text: string, structured?: unknown) => ({
      text,
      ...(structured !== undefined && { structured }),
      session: `${String(ask.options.model)}#${String(n)}`,
      tokens: 1,
    });
    const { prompt } = ask;
    if (prompt.includes("Open the meeting")) return reply("What do we build it with?");
    if (prompt.includes("first judgment")) return reply("Canvas.");
    if (prompt.includes("Would you speak next?")) return reply(await (script.hand?.(ask) ?? ""));
    if (prompt.includes("Call give_floor first"))
      return reply(await (script.steer?.(ask) ?? Promise.resolve("Settled.")));
    if (prompt.includes("You have the floor")) return reply("WebGL is overkill.");
    if (prompt.includes("final plan")) return reply("", plan);
    throw new Error(`Unscripted: ${prompt.slice(0, 40)}`);
  });
}

const ended = (meeting: Meeting) =>
  vi.waitFor(() => {
    expect(meeting.status).not.toBe("running");
  });
const phases = (meeting: Meeting) =>
  meeting.turns.map((t: MeetingTurn) => `${t.phase}:${t.speaker}`);

describe("nextMove", () => {
  const turn = (phase: MeetingTurn["phase"], speaker: string, calls?: string): MeetingTurn => ({
    phase,
    speaker,
    text: "",
    at: 0,
    tokens: 0,
    ...(calls && { calls }),
  });
  const at = (turns: MeetingTurn[]) =>
    nextMove({ turns, participants: ["host", "a", "b"], size: "small" });

  it("walks from the opening through everyone's first judgment to the discussion", () => {
    expect(at([])).toEqual({ kind: "open" });
    expect(at([turn("opening", "host"), turn("round", "a")])).toEqual({
      kind: "round",
      member: "b",
    });
    const rounds = [turn("opening", "host"), turn("round", "a"), turn("round", "b")];
    expect(at(rounds)).toEqual({ kind: "discuss", left: 2 });
    expect(at([...rounds, turn("steer", "host", "b")])).toEqual({ kind: "answer", member: "b" });
    expect(at([...rounds, turn("steer", "host")])).toEqual({ kind: "close" });
    expect(at([...rounds, turn("answer", "a"), turn("answer", "b")])).toEqual({ kind: "close" });
  });
});

describe("Meetings", () => {
  it("talk it through with hands and the floor, and hand you the host's plan", async () => {
    scripted({
      hand: async (ask) => {
        await call(ask, { point: "Canvas is enough", to: "glm" });
        return "";
      },
      steer: async (ask) => {
        await call(ask, { member: "sonnet", quiet: true });
        return "";
      },
    });
    const meeting = meetings.start({
      goalId: "g1",
      agenda: "A dice game",
      size: "small",
      attendees: [],
    });
    expect(meeting).toMatchObject({ host: "glm", participants: ["glm", "sonnet"] });
    await ended(meeting);
    expect(meeting.status).toBe("review");
    expect(phases(meeting)).toEqual([
      "opening:glm",
      "round:sonnet",
      "steer:glm",
      "answer:sonnet",
      "summary:glm",
    ]);
    expect(meeting.plan?.tasks[0]?.subtasks.map((s) => [s.key, s.assignee, s.dependsOn])).toEqual([
      ["a", "sonnet", []],
      ["b", "glm", ["a"]],
    ]);
    expect(meeting.seats).toBeUndefined();

    const asks = vi.mocked(askOnce).mock.calls.map(([ask]) => ask);
    expect(asks[0]?.options).toEqual({
      cwd: goalFolder(core.places, "dice"),
      model: "glm/meeting",
    });
    const hand = asks.find((a) => a.prompt.includes("Would you speak next?"));
    expect(hand?.options).toMatchObject({
      resume: "sonnet/meeting#2",
      allowedTools: ["mcp__openplan__raise_hand"],
    });
    const answer = asks.find((a) => a.prompt.includes("You have the floor"));
    expect(answer?.prompt).toContain("for what you raised your hand about: Canvas is enough");
    expect(asks.at(-1)?.schema).toMatchObject({ type: "object" });
    expect(pump).toHaveBeenCalled();
  });

  it("close when nobody raises a hand and the host finds it settled", async () => {
    scripted();
    const meeting = meetings.start({
      goalId: "g1",
      agenda: "x",
      size: "large",
      attendees: ["sonnet", "glm"],
    });
    await ended(meeting);
    expect(meeting.host).toBe("sonnet");
    expect(phases(meeting)).toEqual([
      "opening:sonnet",
      "round:glm",
      "steer:sonnet",
      "summary:sonnet",
    ]);
  });

  it("fail with the error, and go on from where they stopped in the same sessions", async () => {
    scripted();
    const original = vi.mocked(askOnce).getMockImplementation();
    vi.mocked(askOnce).mockImplementation((ask) =>
      ask.prompt.includes("first judgment")
        ? Promise.reject(new Error("API Error: 529"))
        : (original?.(ask) ?? Promise.reject(new Error("no script"))),
    );
    const meeting = meetings.start({ goalId: "g1", agenda: "x", size: "small", attendees: [] });
    await ended(meeting);
    expect(meeting).toMatchObject({ status: "failed", error: "API Error: 529" });
    scripted();
    meetings.resume(meeting.id);
    await ended(meeting);
    expect(phases(meeting)).toEqual(["opening:glm", "round:sonnet", "steer:glm", "summary:glm"]);
    const steer = vi.mocked(askOnce).mock.calls.find(([a]) => a.prompt.includes("give_floor"));
    expect(steer?.[0].options.resume).toBe("glm/meeting#1");
  });

  it("are cancelled when stopped, and after a restart", async () => {
    vi.mocked(askOnce).mockImplementation(
      ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            reject(new Error("stopped"));
          });
        }),
    );
    const meeting = meetings.start({ goalId: "g1", agenda: "x", size: "small", attendees: [] });
    await vi.waitFor(() => {
      expect(askOnce).toHaveBeenCalled();
    });
    await meetings.cancel(meeting.id);
    expect(meeting).toMatchObject({ status: "cancelled", speaking: undefined });
    expect(meeting.error).toBeUndefined();

    core.state.meetings.push({ ...meeting, id: "m2", status: "running", speaking: "sonnet" });
    meetings.recover();
    expect(core.state.meetings[1]).toMatchObject({ status: "cancelled", speaking: undefined });
  });

  it("can't be held with a busy member, a stranger, or a goal on hold", () => {
    core.state.subtasks.push({
      id: "s1",
      taskId: "t1",
      goalId: "g1",
      title: "Rules",
      description: "",
      acceptance: "",
      assignee: "glm",
      dependsOn: [],
      status: "running",
      createdAt: 0,
      progress: { done: 0, total: 0 },
      tokens: 0,
    });
    const call = (attendees: string[]) => () =>
      meetings.start({ goalId: "g1", agenda: "x", size: "small", attendees });
    expect(call(["sonnet", "glm"])).toThrow("glm is busy");
    expect(call(["ann"])).toThrow('There is no member called "ann"');
    const [goal] = core.state.goals;
    if (goal) goal.status = "paused";
    expect(call(["sonnet"])).toThrow('The goal "Dice" is paused');
  });
});

import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Core } from "./core.ts";
import { goalFiles } from "../shared/layout.ts";
import { git, openRepository } from "./git.ts";
import { z } from "zod";
import { nextMove } from "./meeting-run.ts";
import { Meetings } from "./meetings.ts";
import { planSchema } from "./plan.ts";
import type { Scheduler } from "./scheduler.ts";
import { askOnce, type Reply } from "./turns.ts";
import { hostOf, type Meeting, type MeetingTurn, type Member } from "./types.ts";

// Meeting tools as plain handlers, so a scripted turn can call them.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  tool: (name: string, _: string, __: unknown, handler: unknown) => ({ name, handler }),
  createSdkMcpServer: (server: unknown) => server,
}));
vi.mock("./turns.ts", async (original) => ({
  ...(await original<typeof import("./turns.ts")>()),
  askOnce: vi.fn(),
}));

const member = (name: string, title: string): Member => ({
  name,
  role: { title, duties: "" },
  env: {},
});

let dir: string;
let core: Core;
let meetings: Meetings;
const pump = vi.fn();
const assign = vi.fn(() => []);

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "huddle-meetings-")));
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
      goal: { name: "Dice", slug: "dice", status: "active", createdAt: 0 },
      tasks: [],
      subtasks: [],
      meetings: [],
      questions: [],
      tokens: {},
    },
    team: { members: [member("sonnet", "Programmer"), member("glm", "UI designer")], review: true },
    places: { repo: await openRepository(repo), slug: "dice", root: path.join(dir, "data") },
    changed: vi.fn(),
    allowAlways: vi.fn(),
    options: (m, kind, cwd) => ({ cwd, model: `${m.name}/${kind}`, settings: `${m.name}.json` }),
    recorder: () => ({}),
    speech: () => ({}),
    underWay: () => [],
    meetingsNow: () => meetings.now(),
    questionsNow: () => [],
  };
  meetings = new Meetings(core, { pump, assign } as unknown as Scheduler);
  vi.mocked(askOnce).mockReset();
  assign.mockClear();
});

afterEach(async () => {
  await meetings.close();
  await rm(dir, { recursive: true, force: true });
});

type Ask = Parameters<typeof askOnce>[0];

/** Calls the turn's meeting tool, as the model would. */
async function call(ask: Ask, args: Record<string, unknown>) {
  const server = ask.options.mcpServers?.huddle as unknown as {
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
    });
    ask.spent(1);
    const { prompt } = ask;
    if (prompt.includes("Open the meeting")) return reply("What do we build it with?");
    // The host's steer goes first: it speaks of the first judgments too.
    if (prompt.includes("give_floor"))
      return reply(await (script.steer?.(ask) ?? Promise.resolve("Settled.")));
    if (prompt.includes("first judgment")) return reply("Canvas.");
    if (prompt.includes("Would you speak next?")) return reply(await (script.hand?.(ask) ?? ""));
    if (prompt.includes("You have the floor")) return reply("WebGL is overkill.");
    if (prompt.includes("final plan")) return reply("", plan);
    throw new Error(`Unscripted: ${prompt.slice(0, 40)}`);
  });
}

/**
 * Waits for `check` to pass: a meeting starts with real git, setting up its
 * goal's worktree, slow while the other test files run alongside.
 */
const eventually = (check: () => unknown) => vi.waitFor(check, { timeout: 10_000 });

const ended = (meeting: Meeting) =>
  eventually(() => {
    expect(meeting.status).not.toBe("running");
  });
const phases = (meeting: Meeting) =>
  meeting.turns.map((t: MeetingTurn) => `${t.phase}:${t.speaker}`);

describe("nextMove", () => {
  const turn = (phase: MeetingTurn["phase"], speaker: string, calls?: string): MeetingTurn => ({
    phase,
    speaker,
    text: "",
    ...(calls && { calls }),
  });
  const at = (turns: MeetingTurn[], hostOnly?: boolean) =>
    nextMove({ turns, participants: ["host", "a", "b"], size: "small", hostOnly });

  it("walks from the opening through every member's first judgment, all at once, to the discussion", () => {
    expect(at([])).toEqual({ kind: "open" });
    expect(at([turn("opening", "host")])).toEqual({ kind: "round", members: ["host", "a", "b"] });
    expect(at([turn("opening", "host"), turn("round", "a")])).toEqual({
      kind: "round",
      members: ["host", "b"],
    });
    expect(at([turn("opening", "host")], true)).toEqual({ kind: "round", members: ["a", "b"] });
    const rounds = [turn("opening", "host"), turn("round", "a"), turn("round", "b")];
    expect(at(rounds)).toEqual({ kind: "round", members: ["host"] });
    expect(at(rounds, true)).toEqual({ kind: "discuss", left: 2 });
    // Once the talk is on, nobody gives a first judgment.
    expect(at([...rounds, turn("steer", "host", "a"), turn("answer", "a")])).toEqual({
      kind: "discuss",
      left: 1,
    });
    const all = [...rounds, turn("round", "host")];
    expect(at(all)).toEqual({ kind: "discuss", left: 2 });
    expect(at([...all, turn("steer", "host", "b")])).toEqual({ kind: "answer", member: "b" });
    expect(at([...all, turn("steer", "host")])).toEqual({ kind: "close" });
    expect(at([...all, turn("answer", "a"), turn("answer", "b")])).toEqual({ kind: "close" });
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
      agenda: "A dice game",
      size: "small",
      attendees: [],
    });
    expect(meeting).toMatchObject({ participants: ["glm", "sonnet"] });
    await ended(meeting);
    expect(meeting.status).toBe("review");
    expect(phases(meeting)).toEqual([
      "opening:glm",
      "round:glm",
      "round:sonnet",
      // Given quietly, the floor goes over with no words of the host's.
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
      cwd: goalFiles(core.places.root).checkout,
      model: "glm/readOnly",
      settings: "glm.json",
    });
    const hand = asks.find((a) => a.prompt.includes("Would you speak next?"));
    expect(hand?.options).toMatchObject({
      resume: "sonnet/readOnly#3",
      allowedTools: ["mcp__huddle__raise_hand"],
    });
    const answer = asks.find((a) => a.prompt.includes("You have the floor"));
    expect(answer?.prompt).toContain("for what you raised your hand about: Canvas is enough");
    expect(asks.at(-1)?.schema).toMatchObject({ type: "object" });
    expect(pump).toHaveBeenCalled();
  });

  it("close when nobody raises a hand and the host finds it settled", async () => {
    scripted();
    const meeting = meetings.start({
      agenda: "x",
      size: "large",
      attendees: ["sonnet", "glm"],
    });
    await ended(meeting);
    expect(hostOf(meeting)).toBe("sonnet");
    expect(phases(meeting)).toEqual([
      "opening:sonnet",
      "round:sonnet",
      "round:glm",
      "steer:sonnet",
      "summary:sonnet",
    ]);
  });

  it("close when the host gives the floor to nobody, hands up or not", async () => {
    scripted({
      hand: async (ask) => {
        await call(ask, { point: "What the score file holds" });
        return "";
      },
    });
    const meeting = meetings.start({ agenda: "x", size: "small", attendees: [] });
    await ended(meeting);
    expect(phases(meeting)).toEqual([
      "opening:glm",
      "round:glm",
      "round:sonnet",
      "steer:glm",
      "summary:glm",
    ]);
  });

  it("say to the room what the host said before handing the floor over, and after", async () => {
    scripted({
      steer: async (ask) => {
        ask.listener?.text?.("Two views on the renderer.", true);
        await call(ask, { member: "sonnet" });
        ask.listener?.text?.("Sonnet, which?", true);
        return "Sonnet, which?";
      },
    });
    const meeting = meetings.start({ agenda: "x", size: "small", attendees: [] });
    await ended(meeting);
    expect(meeting.turns.find((t) => t.phase === "steer")).toMatchObject({
      text: "Two views on the renderer.\n\nSonnet, which?",
      calls: "sonnet",
    });
  });

  it("with a host who only runs it, hear only the members' judgments and give them all the work", async () => {
    scripted();
    const original = vi.mocked(askOnce).getMockImplementation();
    const drafting: (string | undefined)[] = [];
    const sonnets = {
      ...plan,
      tasks: plan.tasks.map((t) => ({
        ...t,
        subtasks: t.subtasks.map((sub) => ({ ...sub, assignee: "sonnet" })),
      })),
    };
    vi.mocked(askOnce).mockImplementation((ask) => {
      if (ask.prompt.includes("Everyone now gives a first judgment"))
        drafting.push(meetings.now()[core.state.meetings[0]?.id ?? ""]?.together);
      if (ask.prompt.includes("final plan"))
        return Promise.resolve({ text: "", structured: sonnets, session: "glm#9" });
      return original?.(ask) ?? Promise.reject(new Error("no script"));
    });
    const meeting = meetings.start({
      agenda: "x",
      size: "small",
      attendees: ["glm", "sonnet"],
      hostOnly: true,
    });
    expect(meeting.hostOnly).toBe(true);
    await ended(meeting);
    expect(drafting).toEqual(["drafting"]);
    expect(phases(meeting)).toEqual(["opening:glm", "round:sonnet", "steer:glm", "summary:glm"]);
    const closing = vi.mocked(askOnce).mock.calls.at(-1)?.[0];
    expect(closing?.schema?.safeParse(plan).success).toBe(false);
    expect(closing?.schema?.safeParse(sonnets).success).toBe(true);
    expect(meeting.status).toBe("review");
    expect(() =>
      meetings.start({
        agenda: "x",
        size: "small",
        attendees: ["sonnet"],
        hostOnly: true,
      }),
    ).toThrow("can't only run a meeting with nobody else");
  });

  it("fail with the error, and go on from where they stopped in the same sessions", async () => {
    scripted();
    const original = vi.mocked(askOnce).getMockImplementation();
    vi.mocked(askOnce).mockImplementation((ask) =>
      ask.prompt.includes("first judgment")
        ? Promise.reject(new Error("API Error: 529"))
        : (original?.(ask) ?? Promise.reject(new Error("no script"))),
    );
    const meeting = meetings.start({ agenda: "x", size: "small", attendees: [] });
    await ended(meeting);
    expect(meeting).toMatchObject({ status: "failed", error: "API Error: 529" });
    scripted();
    meetings.resume(meeting.id);
    await ended(meeting);
    expect(phases(meeting)).toEqual([
      "opening:glm",
      "round:glm",
      "round:sonnet",
      "steer:glm",
      "summary:glm",
    ]);
    // The host's first judgment goes on in the session they opened in.
    const round = vi
      .mocked(askOnce)
      .mock.calls.findLast(
        ([a]) => a.prompt.includes("Everyone now gives") && a.options.model === "glm/readOnly",
      );
    expect(round?.[0].options.resume).toBe("glm/readOnly#1");
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
    const meeting = meetings.start({ agenda: "x", size: "small", attendees: [] });
    await eventually(() => {
      expect(askOnce).toHaveBeenCalled();
    });
    await meetings.cancel(meeting.id);
    expect(meeting.status).toBe("cancelled");
    expect(meetings.now()).toEqual({});
    expect(meeting.error).toBeUndefined();

    core.state.meetings.push({ ...meeting, id: "m2", status: "running" });
    meetings.recover();
    expect(core.state.meetings[1]?.status).toBe("cancelled");
  });

  it("can't be held with a busy member, a stranger, or a goal on hold", () => {
    core.state.subtasks.push({
      id: "s1",
      taskId: "t1",
      title: "Rules",
      description: "",
      acceptance: "",
      assignee: "glm",
      dependsOn: [],
      status: "running",
      progress: { done: 0, total: 0 },
    });
    const call = (attendees: string[]) => () =>
      meetings.start({ agenda: "x", size: "small", attendees });
    expect(call(["sonnet", "glm"])).toThrow("glm is busy");
    expect(call(["ann"])).toThrow('There is no member called "ann"');
    core.state.goal.status = "paused";
    expect(call(["sonnet"])).toThrow('The goal "Dice" is paused');
  });
});

describe("A plan under review", () => {
  const reviewed = async () => {
    scripted();
    const meeting = meetings.start({ agenda: "x", size: "small", attendees: [] });
    await ended(meeting);
    return meeting;
  };
  /** The plan with its subtasks given to `assignee`, as the change_plan tool takes it. */
  const changed = (assignee: string) =>
    planSchema(z.string()).parse({
      ...plan,
      plan_markdown: "# Plan, changed",
      tasks: [
        { ...plan.tasks[0], subtasks: plan.tasks[0]?.subtasks.map((s) => ({ ...s, assignee })) },
      ],
    });

  it("takes your changes, and is approved into the goal's work with its document saved", async () => {
    const meeting = await reviewed();
    expect(meeting.plan?.tasks[0]?.ownerAccepts).toBe(false);
    meetings.change(meeting.id, changed("sonnet"));
    expect(meeting.plan?.tasks[0]?.subtasks.map((s) => s.assignee)).toEqual(["sonnet", "sonnet"]);
    expect(meeting.plan?.tasks[0]?.ownerAccepts).toBe(false);
    const mine = changed("sonnet");
    meetings.change(meeting.id, {
      ...mine,
      tasks: mine.tasks.map((task) => ({ ...task, owner_accepts: true })),
    });
    expect(meeting.plan?.tasks[0]?.ownerAccepts).toBe(true);

    await meetings.approve(meeting.id);
    expect(meeting.status).toBe("approved");
    expect(await readFile(goalFiles(core.places.root).plan(meeting.id), "utf8")).toBe(
      "# Plan, changed",
    );
    expect(assign).toHaveBeenCalledWith(meeting.plan?.tasks, meeting.id);
    await expect(meetings.approve(meeting.id)).rejects.toThrow("no plan under review");
  });

  it("is dropped once, and nothing else is: a meeting over, or none", async () => {
    const meeting = await reviewed();
    await meetings.cancel(meeting.id);
    expect(meeting.status).toBe("dropped");
    await expect(meetings.cancel(meeting.id)).rejects.toThrow(
      "The meeting is dropped: there is nothing to cancel",
    );
    await expect(meetings.cancel("m9")).rejects.toThrow("There is no such meeting");
  });

  it("isn't approved once called off while its document is written, or with its goal paused", async () => {
    const meeting = await reviewed();
    const approving = meetings.approve(meeting.id);
    await meetings.cancel(meeting.id);
    await expect(approving).rejects.toThrow("changed while it was being approved");
    expect(meeting.status).toBe("dropped");

    const next = await reviewed();
    core.state.goal.status = "paused";
    await expect(meetings.approve(next.id)).rejects.toThrow('The goal "Dice" is paused');
    expect(next.status).toBe("review");
    expect(assign).not.toHaveBeenCalled();
  });
});

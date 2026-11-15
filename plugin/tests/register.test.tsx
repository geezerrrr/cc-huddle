import type { On } from "claude-code";
import { expect, mock, test } from "claude-code/testing";

import type { OpenplanNeed, OpenplanTeam, OpenplanView } from "../types";

const SERVER = "plugin:openplan:openplan";

const PANE = {
  plugin: "openplan",
  component: "Pane",
  requestId: "openplan",
  props: {
    title: "openplan",
    isFocused: true,
    bodyColumns: 80,
    placement: "dock",
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const;

const BAND = {
  plugin: "openplan",
  component: "AbovePrompt",
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 4,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
} as const;

const NEED: OpenplanNeed = {
  id: "q1",
  from: "glm",
  about: "Rules",
  text: "",
  kind: "permission",
  call: "Bash: npm test",
  options: ["once", "deny"],
};

const TEAM: OpenplanTeam = {
  band: "1 working · 1 needs you",
  tasks: ['Rules · glm works on "Rules"'],
  members: [
    {
      name: "glm",
      role: "Developer",
      model: "glm-5",
      doing: 'works on "Rules"',
      subtask: "s1",
      tokens: 1200,
    },
  ],
  needs: [NEED],
  milestones: [],
  prompts: [],
};

const SOCKET = "/tmp/openplan-test/pane.sock";

/** An answer on the pane's socket. */
const served = (status: number, text: string) => ({
  value: { status, ok: status < 300, headers: {}, text },
});

/**
 * The server as the mod reaches it: its socket's view answers with `views` in
 * turn; each call is kept, the view's as `view`, with each pane opened.
 */
function serve(on: On, views: OpenplanView[]) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  on("mcp.connect", () => ({ value: { isConnected: true, server: SERVER } }));
  on("mcp.call", (_, e) => {
    calls.push({ tool: e.tool, args: e.args });
    const text = e.tool === "pane" ? SOCKET : "Team: glm";
    return { value: { content: [{ type: "text", text }], isError: false } };
  });
  on("http.fetch", (_, e) => {
    expect([e.url, e.init?.socketPath]).toEqual(["http://openplan/view", SOCKET]);
    // The pane asks for its view as JSON text, never as bytes.
    const body = e.init?.body;
    calls.push({
      tool: "view",
      args: JSON.parse(typeof body === "string" ? body : "{}") as Record<string, unknown>,
    });
    return served(200, JSON.stringify(views.length > 1 ? views.shift() : views[0]));
  });
  on("command.register", (_, e) => ({ value: { command: e.name } }));
  on("ui.open", (_, e) => {
    calls.push({ tool: "ui.open", args: { id: e.id, focus: e.focus } });
    return { value: { isPlaced: true } };
  });
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  return calls;
}

test("the band and the pane show the team, and a press answers what needs you", async ($, on) => {
  const clock = mock.clock(on);
  const calls = serve(on, [{ revision: 1, team: TEAM }]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await clock.advance(500);

  const band = await $.ui.mount({ ...BAND, surface: "terminal" });
  expect((await band.find({ type: "Text", text: /openplan/ }))?.text).toBe(
    "openplan · 1 working · 1 needs you",
  );
  expect((await band.find({ type: "Text", text: /Rules ·/ }))?.text).toBe(
    '  Rules · glm works on "Rules"',
  );
  await band.unmount();

  for (const surface of ["terminal", "desktop"] as const) {
    const pane = await $.ui.mount({ ...PANE, surface });
    await pane.press({ key: "tab-team" });
    expect(await pane.find({ type: "Text", text: /works on "Rules"/ })).toBeDefined();
    await pane.press({ key: "tab-needs" });
    expect(await pane.find({ type: "Text", text: "Bash: npm test" })).toBeDefined();
    await pane.press({ key: "q1-once" });
    await pane.unmount();
  }
  expect(calls.filter((c) => c.tool === "answer")).toEqual([
    { tool: "answer", args: { question: "q1", option: "once" } },
    { tool: "answer", args: { question: "q1", option: "once" } },
  ]);
  expect(calls.find((c) => c.tool === "view")?.args).toEqual({});
});

test("the pane follows a member's record as it grows", async ($, on) => {
  const clock = mock.clock(on);
  const calls = serve(on, [
    { revision: 1, team: TEAM },
    {
      revision: 1,
      record: {
        subtask: "s1",
        entries: [
          {
            at: 0,
            kind: "tool",
            name: "Read",
            input: { file_path: "README.md" },
            state: "done",
            output: "",
          },
        ],
        next: 120,
        live: { running: [], streaming: { kind: "text", text: "Reading it" } },
      },
    },
  ]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await clock.advance(500);
  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  await pane.press({ key: "follow-glm" });
  await clock.advance(500);
  expect(calls.at(-1)).toEqual({
    tool: "view",
    args: { revision: 1, record: { subtask: "s1", from: 0 } },
  });
  expect(await pane.find({ type: "Text", text: "✓ Read README.md" })).toBeDefined();
  expect(await pane.find({ type: "Text", text: "Reading it" })).toBeDefined();
  await pane.unmount();
});

test("a new milestone is a transcript row, a new prompt your session's; what was there before is not news", async ($, on) => {
  const clock = mock.clock(on);
  const rows: string[] = [];
  const prompts: string[] = [];
  on("prompt.submit", (_, e) => {
    prompts.push(e.text);
    return { text: e.text };
  });
  on("ui.log", (_, e) => {
    rows.push(e.text);
    return { value: undefined };
  });
  on("tool.call", { tool: "AskUserQuestion" }, () => ({ deny: "dismissed" }));
  serve(on, [
    {
      revision: 1,
      team: {
        ...TEAM,
        milestones: [{ key: "plan:m1", text: 'Plan approved: "Dice"' }],
        prompts: [{ key: "review:m1", text: "A plan to review" }],
      },
    },
    {
      revision: 2,
      team: {
        ...TEAM,
        milestones: [
          { key: "plan:m1", text: 'Plan approved: "Dice"' },
          { key: "done:s1", text: '"Rules" by glm is merged' },
        ],
        prompts: [
          { key: "review:m1", text: "A plan to review" },
          { key: "accept:q2", text: "A task to accept" },
        ],
      },
    },
  ]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await clock.advance(1000);
  expect(rows).toEqual(['openplan: "Rules" by glm is merged']);
  expect(prompts).toEqual(["A task to accept"]);
});

test("each need is asked as it comes, in turn, and answered as you said; a task to accept is your session's", async ($, on) => {
  const clock = mock.clock(on);
  const questions: string[] = [];
  const said = ["Allow once", "don't touch dist", "Grid", "Review again"];
  on("tool.call", { tool: "AskUserQuestion" }, (_, e) => {
    const [question] = e.questions as { question: string }[];
    questions.push(question?.question ?? "");
    return { result: { answers: { [question?.question ?? ""]: said.shift() ?? "" } } };
  });
  const calls = serve(on, [
    {
      revision: 1,
      team: {
        ...TEAM,
        needs: [
          NEED,
          { ...NEED, id: "q2", call: "Bash: rm -rf dist" },
          {
            id: "q3",
            from: "glm",
            about: "",
            text: "",
            kind: "choices",
            choices: [
              {
                question: "Which board?",
                header: "Board",
                options: ["Grid", "Hex"],
                multiSelect: false,
              },
            ],
          },
          {
            id: "q4",
            from: "sonnet",
            about: "Rules",
            text: "Too small",
            kind: "decision",
            of: "review",
            options: ["rereview", "skip", "sendBack"],
          },
          {
            id: "q5",
            from: "glm",
            about: "",
            text: "Game",
            kind: "decision",
            of: "delivery",
            options: ["accept", "revise"],
          },
        ],
      },
    },
  ]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await clock.advance(1000);
  expect(questions).toEqual([
    'glm asks to use Bash: npm test for "Rules". Allow it?',
    'glm asks to use Bash: rm -rf dist for "Rules". Allow it?',
    "glm asks: Which board?",
    'The review of "Rules" is stuck: Too small What now?',
  ]);
  expect(calls.filter((c) => c.tool === "answer").map((c) => c.args)).toEqual([
    { question: "q1", option: "once" },
    { question: "q2", option: "deny", note: "don't touch dist" },
    { question: "q3", picks: ["Grid"] },
    { question: "q4", decision: "rereview" },
  ]);
});

test("the pane stops asking a team that can't be opened, until you or your session turn to it", async ($, on) => {
  const clock = mock.clock(on);
  let views = 0;
  on("mcp.connect", () => ({ value: { isConnected: true, server: SERVER } }));
  on("mcp.call", () => ({ value: { content: [{ type: "text", text: SOCKET }], isError: false } }));
  on("http.fetch", () => {
    views++;
    return served(409, "The team has no members");
  });
  on("command.register", (_, e) => ({ value: { command: e.name } }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  on("tool.call", () => ({ result: "Started." }));
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await clock.advance(2000);
  expect(views).toBe(1);
  await $.command.run({
    command: "openplan",
    args: "",
    origin: { kind: "composer" },
    presentation: { isFullscreen: true, columns: 120 },
  });
  await clock.advance(2000);
  expect(views).toBe(2);
  await $.tool.call({ tool: "mcp__plugin_openplan_openplan__start_goal", name: "Dice" });
  await clock.advance(2000);
  expect(views).toBe(3);
});

test("a team that moved to another session leaves the band, and /openplan takes it back", async ($, on) => {
  const clock = mock.clock(on);
  const asked: Record<string, unknown>[] = [];
  let moved = false;
  on("mcp.connect", () => ({ value: { isConnected: true, server: SERVER } }));
  on("mcp.call", () => ({ value: { content: [{ type: "text", text: SOCKET }], isError: false } }));
  on("http.fetch", (_, e) => {
    const body = e.init?.body;
    const args = JSON.parse(typeof body === "string" ? body : "{}") as Record<string, unknown>;
    asked.push(args);
    return moved && !args.take
      ? served(409, "Another Claude Code session runs this repository's team (pid 7).")
      : served(200, JSON.stringify({ revision: asked.length, team: TEAM }));
  });
  on("command.register", (_, e) => ({ value: { command: e.name } }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("session.start", (_, e) => ({ cwd: e.cwd }));
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await clock.advance(500);
  const band = async () => {
    const mounted = await $.ui.mount({ ...BAND, surface: "terminal" });
    const text = (await mounted.find({ type: "Text", text: /openplan/ }))?.text;
    await mounted.unmount();
    return text;
  };
  expect(await band()).toBe("openplan · 1 working · 1 needs you");

  moved = true;
  await clock.advance(500);
  expect(await band()).toBeUndefined();
  expect(asked.every((args) => !args.take)).toBe(true);

  await $.command.run({
    command: "openplan",
    args: "",
    origin: { kind: "composer" },
    presentation: { isFullscreen: true, columns: 120 },
  });
  await clock.advance(500);
  expect(asked.at(-1)).toMatchObject({ take: true });
  expect(await band()).toBe("openplan · 1 working · 1 needs you");
});

test("the model can't call the pane's tools", async ($) => {
  const { decision } = await $.tool.check({
    tool: "mcp__plugin_openplan_openplan__answer",
    input: { question: "q1", option: "always" },
  });
  expect(decision).toBe("deny");
});

test("/openplan opens the pane with the keyboard", async ($, on) => {
  const calls = serve(on, [{ revision: 1, team: TEAM }]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await $.command.run({
    command: "openplan",
    args: "",
    origin: { kind: "composer" },
    presentation: { isFullscreen: true, columns: 120 },
  });
  expect(calls.filter((c) => c.tool === "ui.open")).toEqual([
    { tool: "ui.open", args: { id: "openplan", focus: true } },
  ]);
});

test("/openplan status prints where the team stands", async ($, on) => {
  serve(on, [{ revision: 1, team: TEAM }]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  const { text } = await $.command.run({
    command: "openplan",
    args: "status",
    origin: { kind: "composer" },
    presentation: { isFullscreen: true, columns: 120 },
  });
  expect(text).toBe("Team: glm");
});

test("/openplan pause and resume pause or resume every goal, with no model turn", async ($, on) => {
  const calls = serve(on, [{ revision: 1, team: TEAM }]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  for (const action of ["pause", "resume"])
    await $.command.run({
      command: "openplan",
      args: action,
      origin: { kind: "composer" },
      presentation: { isFullscreen: true, columns: 120 },
    });
  expect(calls.filter((c) => c.tool === "every_goal")).toEqual([
    { tool: "every_goal", args: { action: "pause" } },
    { tool: "every_goal", args: { action: "resume" } },
  ]);
});

test("/openplan with a task hands it to your session for the team, with who is on it", async ($, on) => {
  const clock = mock.clock(on);
  const calls = serve(on, [{ revision: 1, team: TEAM }]);
  const prompts: string[] = [];
  on("prompt.submit", (_, e) => {
    prompts.push(e.text);
    return { text: e.text };
  });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await clock.advance(500);
  await $.command.run({
    command: "openplan",
    args: "make a dice game, @glm on the rules",
    origin: { kind: "composer" },
    presentation: { isFullscreen: true, columns: 120 },
  });
  await clock.advance(1);
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("The team: glm (Developer).");
  expect(prompts[0]).toContain("\nmake a dice game, @glm on the rules\n");
  expect(calls.filter((c) => c.tool === "ui.open")).toEqual([]);
});

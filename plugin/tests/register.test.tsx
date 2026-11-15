import type { On } from "claude-code";
import { expect, mock, test, type Engine } from "claude-code/testing";

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

/** A permission request, as the server words it. */
const permission = (id: string, call: string): OpenplanNeed => ({
  id,
  from: "glm",
  headline: `glm asks to use ${call} for "Rules". Allow it?`,
  ask: true,
  kind: "options",
  options: [
    { value: "once", label: "Allow once", primary: true },
    { value: "deny", label: "Deny" },
  ],
  note: { option: "deny", label: "Deny", prompt: "Or deny it, saying why" },
});

const NEED = permission("q1", "Bash: npm test");

const TEAM: OpenplanTeam = {
  opened: 1,
  band: "1 working · 1 needs you",
  tasks: ['Rules · glm works on "Rules"'],
  members: [
    {
      name: "glm",
      line: "Developer · glm-5 · 1,200 tokens",
      doing: 'works on "Rules"',
      followable: true,
    },
  ],
  needs: [NEED],
  milestones: [],
  prompts: [],
  resumable: [],
  resumeRefused:
    '"Dice" is under way in this session, which runs one goal: /openplan pause it first, or take the other up in another session.',
  typedAnswersNone: "openplan: what you typed answers none of it; it waits in Needs you",
};

/** The team of a session that runs no goal. */
const NO_GOAL: OpenplanTeam = {
  noGoal: "This session runs no goal. Hand the team a task with /openplan <task>.",
  opened: 1,
  tasks: [],
  members: [],
  needs: [],
  milestones: [],
  prompts: [],
  resumable: [],
  typedAnswersNone: "openplan: what you typed answers none of it; it waits in Needs you",
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
    const text =
      e.tool === "pane"
        ? SOCKET
        : e.tool === "resume_goal"
          ? `Resumed ${String(e.args.goal)}.`
          : e.tool === "hand_off"
            ? `For the team: ${String(e.args.task)}`
            : "Team: glm";
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
    calls.push({ tool: "ui.open", args: { id: e.id, title: e.title, focus: e.focus } });
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
    expect(
      await pane.find({
        type: "Text",
        text: 'glm asks to use Bash: npm test for "Rules". Allow it?',
      }),
    ).toBeDefined();
    await pane.press({ key: "q1-once" });
    await pane.unmount();
  }
  expect(calls.filter((c) => c.tool === "answer")).toEqual([
    { tool: "answer", args: { question: "q1", answer: { kind: "option", option: "once" } } },
    { tool: "answer", args: { question: "q1", answer: { kind: "option", option: "once" } } },
  ]);
  expect(calls.find((c) => c.tool === "view")?.args).toEqual({});
});

test("a member's record shows in place of the team as it grows, and Back shows the team again", async ($, on) => {
  const clock = mock.clock(on);
  const calls = serve(on, [
    { revision: 1, team: TEAM },
    {
      revision: 1,
      record: {
        subtask: "s1",
        entries: [
          { kind: "thinking", text: "Look at\nthe rules" },
          {
            kind: "tool",
            name: "Read",
            argument: "README.md",
            state: "done",
            output: "one\ntwo\nthree\nfour\nfive\n",
          },
        ],
        next: 120,
        live: { running: [], streaming: { kind: "text", text: "Reading it" } },
      },
    },
    {
      revision: 1,
      record: { subtask: "s1", entries: [{ kind: "text", text: "Read." }], next: 150 },
    },
    {
      revision: 1,
      record: { subtask: "s2", entries: [{ kind: "text", text: "Fresh" }], next: 10 },
    },
  ]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await clock.advance(500);
  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  await pane.press({ key: "tab-team" });
  await pane.press({ key: "follow-glm" });
  await clock.advance(500);
  expect(calls.at(-1)).toEqual({
    tool: "view",
    args: { revision: 1, record: { member: "glm" } },
  });
  const opened = () => calls.filter((c) => c.tool === "ui.open").map((c) => c.args.title);
  expect(opened()).toEqual(["openplan · glm"]);
  expect(await pane.find({ key: "follow-glm" })).toBeUndefined();
  const texts = (await pane.findAll({ type: "Text" })).map((t) => t.text);
  expect(texts).toEqual(
    expect.arrayContaining([
      "∴ Look at the rules",
      "⏺ Read(README.md)",
      "  ⎿  one",
      "     three",
      "     … +2 lines",
    ]),
  );
  expect(texts).not.toContain("     four");
  expect((await pane.find({ key: "record-streaming-md" }))?.text).toBe("Reading it");
  expect(texts.at(-1)).toMatch(/^b back to the team · 1 meeting/);
  // Read on from where it left off, and added to what it has.
  await clock.advance(500);
  expect(calls.at(-1)?.args).toEqual({
    revision: 1,
    record: { member: "glm", read: { subtask: "s1", next: 120 } },
  });
  expect((await pane.find({ key: "record-e2-md" }))?.text).toBe("Read.");
  // Onto the member's new work: its record in place of the old.
  await clock.advance(500);
  expect((await pane.find({ key: "record-e0-md" }))?.text).toBe("Fresh");
  expect(await pane.find({ type: "Text", text: "∴ Look at the rules" })).toBeUndefined();
  await pane.press({ key: "back" });
  expect(opened()).toEqual(["openplan · glm", "openplan"]);
  expect(await pane.find({ key: "follow-glm" })).toBeDefined();
  await pane.unmount();
});

test("the meeting shows the turn being spoken as a record, and your scrolling reaches the window as you moved it", async ($, on) => {
  const clock = mock.clock(on);
  const calls = serve(on, [
    {
      revision: 1,
      team: {
        ...TEAM,
        meeting: {
          heading: "Dice · sonnet speaks",
          attendance: "glm and sonnet, hosted by glm",
          agenda: "Plan the game",
          turns: [{ heading: "glm → sonnet", text: "A grid board" }],
        },
      },
      speaking: {
        speech: "sp1",
        speaker: "sonnet",
        next: 1,
        entries: [
          {
            kind: "tool",
            name: "Grep",
            argument: "board",
            state: "done",
            output: "src/board.ts",
          },
        ],
        live: { running: [], streaming: { kind: "thinking", text: "Hex or\ngrid" } },
      },
    },
    {
      revision: 1,
      speaking: {
        speech: "sp1",
        speaker: "sonnet",
        entries: [{ kind: "text", text: "Hex it is" }],
        next: 2,
        live: { running: [] },
      },
    },
  ]);
  const moved: number[] = [];
  on("ui.scroll", (_, e) => {
    moved.push(e.offset);
    return {};
  });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await clock.advance(500);
  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  await pane.press({ key: "tab-meeting" });
  expect((await pane.find({ key: "said-0" }))?.text).toBe("A grid board");
  // The turn being spoken shows what it looks up and thinks, as a member's record does.
  const texts = (await pane.findAll({ type: "Text" })).map((t) => t.text);
  expect(texts).toEqual(
    expect.arrayContaining(["sonnet", "⏺ Grep(board)", "  ⎿  src/board.ts", "Hex or grid"]),
  );
  // Away from the end, then back at it, where the meeting is kept in sight again.
  for (const offset of [30, 60])
    await $.ui.scroll({
      component: "Pane",
      requestId: "openplan",
      offset,
      by: offset === 30 ? -30 : 30,
      bodyRows: 40,
      contentRows: 100,
      origin: { kind: "person" },
    });
  expect(moved).toEqual([30, 60]);
  // The speech read on from where it left off, and added to what it has.
  await clock.advance(500);
  expect(calls.at(-1)?.args).toEqual({ revision: 1, speaking: { speech: "sp1", next: 1 } });
  expect((await pane.find({ key: "speaking-e1-md" }))?.text).toBe("Hex it is");
  expect(await pane.find({ type: "Text", text: "⏺ Grep(board)" })).toBeDefined();
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
  const said = ["Allow once", "don't touch dist", "Grid", "make it bigger"];
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
          permission("q2", "Bash: rm -rf dist"),
          {
            id: "q3",
            from: "glm",
            headline: "glm asks:",
            ask: true,
            kind: "choices",
            choices: [
              {
                question: "Which board?",
                header: "Board",
                options: [{ label: "Grid", description: "Squares" }, { label: "Hex" }],
                multiSelect: false,
              },
            ],
          },
          {
            id: "q4",
            from: "sonnet",
            headline: 'The review of "Rules" is stuck. What now?',
            detail: "Too small",
            ask: true,
            kind: "options",
            options: [
              { value: "rereview", label: "Review again" },
              { value: "skip", label: "Skip the review" },
              { value: "sendBack", label: "Send back" },
            ],
            note: { option: "sendBack", label: "Send back", prompt: "Or send it back" },
          },
          {
            id: "q5",
            from: "glm",
            headline: 'The task "Game" is done. Accept it?',
            ask: false,
            kind: "options",
            options: [{ value: "accept", label: "Accept" }],
            note: { option: "revise", label: "Send back", prompt: "What to change" },
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
    "glm asks: Which board?\n- Grid: Squares",
    'The review of "Rules" is stuck. What now?\nToo small',
  ]);
  expect(calls.filter((c) => c.tool === "answer").map((c) => c.args)).toEqual([
    { question: "q1", answer: { kind: "option", option: "once" } },
    { question: "q2", answer: { kind: "option", option: "deny", note: "don't touch dist" } },
    { question: "q3", answer: { kind: "choices", picks: ["Grid"] } },
    { question: "q4", answer: { kind: "option", option: "sendBack", note: "make it bigger" } },
  ]);
});

test("the pane stops asking when the goals can't be read, until you or your session turn to it", async ($, on) => {
  const clock = mock.clock(on);
  let views = 0;
  on("mcp.connect", () => ({ value: { isConnected: true, server: SERVER } }));
  on("mcp.call", () => ({ value: { content: [{ type: "text", text: SOCKET }], isError: false } }));
  on("http.fetch", () => {
    views++;
    return served(409, "/ is not in a git repository");
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

test("a goal that moved to another session leaves the pane, and the band says where it is", async ($, on) => {
  const clock = mock.clock(on);
  serve(on, [
    { revision: 1, team: TEAM },
    {
      revision: 2,
      team: {
        ...NO_GOAL,
        band: "1 goal in another session",
        resumable: [{ slug: "dice", label: "Dice · no plan yet · in another session" }],
      },
    },
  ]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await clock.advance(500);
  const band = async () => {
    const mounted = await $.ui.mount({ ...BAND, surface: "terminal" });
    const text = (await mounted.find({ type: "Text", text: /openplan/ }))?.text;
    await mounted.unmount();
    return text;
  };
  expect(await band()).toBe("openplan · 1 working · 1 needs you");
  await clock.advance(500);
  expect(await band()).toBe("openplan · 1 goal in another session");
  const pane = await $.ui.mount({ ...PANE, surface: "terminal" });
  expect(await pane.find({ type: "Text", text: NO_GOAL.noGoal })).toBeDefined();
  expect(
    await pane.find({ type: "Text", text: "Dice · no plan yet · in another session" }),
  ).toBeDefined();
  await pane.unmount();
});

test("the model can't call the pane's tools", async ($) => {
  const { decision } = await $.tool.check({
    tool: "mcp__plugin_openplan_openplan__answer",
    input: { question: "q1", answer: { kind: "option", option: "always" } },
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
    { tool: "ui.open", args: { id: "openplan", title: "openplan", focus: true } },
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

/** Runs `/openplan <args>` from the prompt, giving what it printed. */
async function openplan($: Engine, args: string) {
  const { text } = await $.command.run({
    command: "openplan",
    args,
    origin: { kind: "composer" },
    presentation: { isFullscreen: true, columns: 120 },
  });
  return text;
}

const resumable = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    slug: `g${String(i + 1)}`,
    label: "Dice · no plan yet · paused",
  }));

test("/openplan pause pauses the session's goal, and resume takes up the only one, with no model turn", async ($, on) => {
  const calls = serve(on, [
    {
      revision: 1,
      team: { ...TEAM, resumable: resumable(1), resumeRefused: undefined },
    },
  ]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await openplan($, "pause");
  expect(await openplan($, "resume")).toBe("Resumed g1.");
  expect(calls.filter((c) => /_goal$|^goal_action$/.test(c.tool))).toEqual([
    { tool: "goal_action", args: { action: "pause" } },
    { tool: "resume_goal", args: { goal: "g1" } },
  ]);
});

test("/openplan pause says why it pauses nothing, with no call", async ($, on) => {
  const calls = serve(on, [{ revision: 1, team: { ...NO_GOAL, pauseRefused: NO_GOAL.noGoal } }]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  expect(await openplan($, "pause")).toBe(NO_GOAL.noGoal);
  expect(calls.filter((c) => c.tool === "goal_action")).toEqual([]);
});

test("/openplan resume says why it takes nothing up while the session's goal is under way", async ($, on) => {
  const calls = serve(on, [{ revision: 1, team: { ...TEAM, resumable: resumable(1) } }]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  expect(await openplan($, "resume")).toBe(TEAM.resumeRefused);
  expect(calls.filter((c) => c.tool === "resume_goal")).toEqual([]);
});

test("/openplan resume asks which goal when there are several, each numbered", async ($, on) => {
  const asked: string[][] = [];
  const said = ["2. Dice · no plan yet · paused"];
  on("tool.call", { tool: "AskUserQuestion" }, (_, e) => {
    const [question] = e.questions as { question: string; options: { label: string }[] }[];
    asked.push(question?.options.map((o) => o.label) ?? []);
    const answer = said.shift();
    return answer
      ? { result: { answers: { [question?.question ?? ""]: answer } } }
      : { deny: "dismissed" };
  });
  const calls = serve(on, [{ revision: 1, team: { ...NO_GOAL, resumable: resumable(2) } }]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  expect(await openplan($, "resume")).toBe("Resumed g2.");
  expect(await openplan($, "resume")).toBe("Nothing resumed.");
  expect(asked).toEqual([
    ["1. Dice · no plan yet · paused", "2. Dice · no plan yet · paused"],
    ["1. Dice · no plan yet · paused", "2. Dice · no plan yet · paused"],
  ]);
  expect(calls.filter((c) => c.tool === "resume_goal")).toEqual([
    { tool: "resume_goal", args: { goal: "g2" } },
  ]);
});

test("/openplan resume lists more goals than the dialog holds, to pick by number", async ($, on) => {
  const calls = serve(on, [{ revision: 1, team: { ...NO_GOAL, resumable: resumable(5) } }]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  expect(await openplan($, "resume")).toBe(
    [
      "Goals; resume one with /openplan resume <number>:",
      ...resumable(5).map((g, i) => `${String(i + 1)}. ${g.label}`),
    ].join("\n"),
  );
  expect(await openplan($, "resume 6")).toBe("No goal is numbered 6.");
  expect(await openplan($, "resume 5")).toBe("Resumed g5.");
  expect(calls.filter((c) => c.tool === "resume_goal")).toEqual([
    { tool: "resume_goal", args: { goal: "g5" } },
  ]);
});

test("a goal taken up puts what waits in it to your session at once; its milestones so far are not news", async ($, on) => {
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
  const taken: OpenplanTeam = {
    ...TEAM,
    needs: [],
    opened: 2,
    milestones: [{ key: "plan:m1", text: 'Plan approved: "Dice"' }],
    prompts: [{ key: "accept:q2", text: "A task to accept" }],
  };
  serve(on, [
    { revision: 1, team: { ...NO_GOAL, resumable: resumable(1) } },
    { revision: 1, team: { ...NO_GOAL, resumable: resumable(1) } },
    { revision: 2, team: taken },
  ]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await clock.advance(500);
  expect(await openplan($, "resume")).toBe("Resumed g1.");
  await clock.advance(500);
  expect(rows).toEqual([]);
  expect(prompts).toEqual(["A task to accept"]);
});

test("/openplan with a task hands your session the prompt the server makes for it", async ($, on) => {
  const clock = mock.clock(on);
  const calls = serve(on, [{ revision: 1, team: TEAM }]);
  const prompts: string[] = [];
  on("prompt.submit", (_, e) => {
    prompts.push(e.text);
    return { text: e.text };
  });
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await clock.advance(500);
  await openplan($, "make a dice game, @glm on the rules");
  await clock.advance(1);
  expect(calls.filter((c) => c.tool === "hand_off")).toEqual([
    { tool: "hand_off", args: { task: "make a dice game, @glm on the rules" } },
  ]);
  expect(prompts).toEqual(["For the team: make a dice game, @glm on the rules"]);
  expect(calls.filter((c) => c.tool === "ui.open")).toEqual([]);
});

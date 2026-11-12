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
};

/** The server as the mod reaches it: `view` answers with `views` in turn, the rest is kept. */
function serve(on: On, views: OpenplanView[]) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  on("mcp.connect", () => ({ value: { isConnected: true, server: SERVER } }));
  on("mcp.call", (_, e) => {
    calls.push({ tool: e.tool, args: e.args });
    const text =
      e.tool === "view" ? JSON.stringify(views.length > 1 ? views.shift() : views[0]) : "Team: glm";
    return { value: { content: [{ type: "text", text }], isError: false } };
  });
  on("command.register", (_, e) => ({ value: { command: e.name } }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
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

test("a new need is a toast, a new milestone a transcript row; what was there before is not news", async ($, on) => {
  const clock = mock.clock(on);
  const toasts: string[] = [];
  const rows: string[] = [];
  on("ui.toast", (_, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  on("ui.log", (_, e) => {
    rows.push(e.text);
    return { value: undefined };
  });
  serve(on, [
    {
      revision: 1,
      team: { ...TEAM, milestones: [{ key: "plan:m1", text: 'Plan approved: "Dice"' }] },
    },
    {
      revision: 2,
      team: {
        ...TEAM,
        needs: [...TEAM.needs, { ...NEED, id: "q2", call: "Bash: rm -rf dist" }],
        milestones: [
          { key: "plan:m1", text: 'Plan approved: "Dice"' },
          { key: "done:s1", text: '"Rules" by glm is merged' },
        ],
      },
    },
  ]);
  await $.session.start({ cwd: "/", surface: "terminal", isInteractive: true });
  await clock.advance(1000);
  expect(toasts).toEqual(["openplan: glm asks to use Bash: rm -rf dist. Answer it in /openplan."]);
  expect(rows).toEqual(['openplan: "Rules" by glm is merged']);
});

test("the model can't call the pane's tools", async ($) => {
  const { decision } = await $.tool.check({
    tool: "mcp__plugin_openplan_openplan__answer",
    input: { question: "q1", option: "always" },
  });
  expect(decision).toBe("deny");
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

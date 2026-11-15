/**
 * openplan's mod (docs/design.md §7.2): the pane, the band above the prompt,
 * asks for what needs you, transcript rows for milestones, prompts to your
 * session for what needs a conversation, and the `/openplan` command, which
 * hands the team a task. It draws what the MCP server serves on the pane's
 * socket, which the `pane` tool names, and answers through the `answer`
 * tool, with no model in between; the model is kept from both tools.
 */
import type { Register } from "claude-code";
import { pauseGoal, resumeGoal } from "./goals";
import { following, openPane, paneView, scrollPane } from "./pane";
import type { Ui } from "./rows";
import { call } from "./server";
import { PANE, PLUGIN, readTeam } from "./state";
import { words } from "./text";
import { watch } from "./watch";

/** The server's tools, as the model names them. */
const TOOLS = /^mcp__plugin_openplan_openplan__/;
/** The tools only the mod calls, as the model would name them. */
const PANE_ONLY = /^mcp__plugin_openplan_openplan__(pane|answer|hand_off|resume_goal)$/;
const PANE_ONLY_REASON = "This tool is the user's, in /openplan.";

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({
      name: "openplan",
      description:
        "Hand openplan's team a task; with none, show the team in a pane; `/openplan status` prints where it stands, `pause` pauses this session's goal and `resume` resumes it or takes up another",
      argumentHint: "[task | status | pause | resume [number]]",
    });
    watch($);
    return next(e);
  });

  on("command.run", { command: "openplan" }, async ($, e) => {
    watch($);
    const task = e.args.trim();
    // Certain, so said without a model turn.
    const certain: Record<string, () => Promise<string>> = {
      status: () => call($, "status", {}),
      pause: () => pauseGoal($),
      resume: () => resumeGoal($),
    };
    const numbered = /^resume\s+(\d+)$/.exec(task);
    const run = numbered ? () => resumeGoal($, Number(numbered[1])) : certain[task];
    if (run) {
      try {
        return { text: await run() };
      } catch (error) {
        return { text: `openplan: ${words(error)}` };
      }
    }
    if (!task) {
      await openPane($);
      return {};
    }
    let text: string;
    try {
      text = await call($, "hand_off", { task });
    } catch (error) {
      return { text: `openplan: ${words(error)}` };
    }
    // Once the command is done: a prompt submitted while it runs would wait on it.
    $.clock.after(0, () => {
      $.prompt.submit({ text }).catch((error: unknown) => {
        $.ui.toast(`openplan: your session couldn't be given the task: ${words(error)}`);
      });
    });
    return {};
  });

  // Your session at the team: it may have one to open now.
  on("tool.call", { tool: TOOLS }, async ($, e, next) => {
    const result = await next(e);
    watch($);
    return result;
  });

  // The pane's tools are the person's: the model never answers a permission for
  // them. The mod's own calls (`$.mcp.call`) are checked too, and go on.
  on("tool.check", { tool: PANE_ONLY }, ($, e, next) =>
    next.origin.plugin === PLUGIN ? next(e) : { decision: "deny", reason: PANE_ONLY_REASON },
  ).catch(() => ({ decision: "deny", reason: PANE_ONLY_REASON }));
  on("tool.describe", { tool: PANE_ONLY }, async ($, e, next) => ({
    ...(await next(e)),
    isDeferred: true,
  }));

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const now = await readTeam($);
    if (!now?.band || e.props.hasSurvey) return next(e);
    // Plain text, not a button: a button above the prompt takes ctrl+x and tab before the pane does.
    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box flexDirection="column">
        <Text dimColor>openplan · {now.band}</Text>
        {now.tasks.map((line, i) => (
          <Text key={`task-${String(i)}`} dimColor>
            {"  "}
            {line}
          </Text>
        ))}
      </Box>
    );
  });

  on("ui.scroll", { requestId: PANE, origin: { kind: "person" } }, async ($, e, next) => {
    const moved = await next(e);
    if (e.offset >= e.contentRows - e.bodyRows && (await following($))) scrollPane($, "end");
    return moved;
  });

  on("ui.render", { component: "Pane", requestId: PANE }, async ($, e) => {
    const ui: Ui = $.ui.resolve(e);
    return paneView($, ui);
  });
};

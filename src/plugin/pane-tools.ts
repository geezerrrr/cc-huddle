/**
 * The tools of openplan's mod (docs/design.md §7.2, §7.3): where the pane
 * reads the team (`pane`, its socket), how it answers what waits on you
 * (`answer`), what `/openplan resume` does (`resume_goal`), and the prompt
 * `/openplan <task>` gives your session (`hand_off`). They are the mod's, not
 * your session's: the mod keeps the model from calling them, so a permission
 * is granted only by you, pressing its button, and a goal is taken up only on
 * your word.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DECISION_OPTIONS, PERMISSION_OPTIONS, type PermissionOption } from "../engine/types.ts";
import { toolText } from "../engine/turns.ts";
import type { PaneServer } from "./pane-server.ts";
import type { Session } from "./session.ts";
import { handOffText } from "./words.ts";
import { SLUG } from "../engine/git.ts";

const isPermission = (option: string): option is PermissionOption =>
  (PERMISSION_OPTIONS as readonly string[]).includes(option);

const PANE_ONLY = "For openplan's pane only: your session never calls it.";

/** Adds the pane's tools to `server`, for the goal the session runs (`session`). */
export function addPaneTools(server: McpServer, session: Session, pane: PaneServer) {
  server.registerTool(
    "pane",
    {
      description: `${PANE_ONLY} The socket the pane reads the team from.`,
      annotations: { readOnlyHint: true },
    },
    () => toolText(pane.address),
  );

  server.registerTool(
    "answer",
    {
      description: `${PANE_ONLY} Answers what waits on the user, as they pressed it.`,
      inputSchema: {
        question: z.string(),
        option: z
          .enum([...PERMISSION_OPTIONS, ...DECISION_OPTIONS])
          .optional()
          .describe("A permission's or a decision's answer"),
        picks: z.array(z.string()).optional().describe("One pick per question with choices"),
        note: z.string().trim().optional().describe("Why it is denied, or what to change"),
        sent_back: z.string().optional().describe("The subtask a revised task goes back to"),
      },
    },
    async ({ question, option, picks, note, sent_back }) => {
      await session.goal.answer(
        question,
        option === undefined
          ? { kind: "choices", picks: picks ?? [] }
          : isPermission(option)
            ? { kind: "permission", option, note }
            : { kind: "decision", option, note, sentBack: sent_back },
      );
      return toolText(`Answered ${question}.`);
    },
  );

  server.registerTool(
    "hand_off",
    {
      description: `${PANE_ONLY} The prompt /openplan <task> gives the session: the task, for the team.`,
      inputSchema: { task: z.string().trim().min(1) },
      annotations: { readOnlyHint: true },
    },
    ({ task }) => {
      const engine = session.current;
      return toolText(
        handOffText(task, engine && { goal: engine.state.goal, members: engine.team.members }),
      );
    },
  );

  server.registerTool(
    "resume_goal",
    {
      description: `${PANE_ONLY} Takes up the goal you picked in this session and resumes it, as /openplan resume.`,
      inputSchema: {
        goal: z.string().regex(SLUG).describe("The goal's slug"),
      },
    },
    async ({ goal: slug }) => {
      const { goal } = (await session.takeUp(slug)).state;
      return toolText(`Resumed "${goal.name}".`);
    },
  );
}

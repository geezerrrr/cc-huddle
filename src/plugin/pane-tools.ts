/**
 * The tools of openplan's mod (docs/design.md §7.2, §7.3): where the pane
 * reads the team (`pane`, its socket), how it answers what waits on you
 * (`answer`), and what `/openplan pause` and `/openplan resume` do
 * (`pause_goal`, `resume_goal`). They are the mod's, not your session's: the
 * mod keeps the model from calling them, so a permission is granted only by
 * you, pressing its button, and a goal is taken up only on your word.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Answer } from "../engine/questions.ts";
import { DECISION_OPTIONS, PERMISSION_OPTIONS } from "../engine/types.ts";
import { toolText } from "../engine/turns.ts";
import type { PaneServer } from "./pane-server.ts";
import type { Session } from "./session.ts";
import { decisionOf } from "./tools.ts";

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
        option: z.enum(PERMISSION_OPTIONS).optional().describe("A permission's answer"),
        picks: z.array(z.string()).optional().describe("One pick per question with choices"),
        decision: z.enum(DECISION_OPTIONS).optional(),
        note: z.string().trim().optional().describe("Why it is denied, or what to change"),
        sent_back: z.string().optional().describe("The subtask a revised task goes back to"),
      },
    },
    async ({ question, option, picks, decision, note, sent_back }) => {
      const answer: Answer = option
        ? { option, ...(note && { note }) }
        : decision
          ? decisionOf(decision, note, sent_back)
          : { picks: picks ?? [] };
      await session.goal.answer(question, answer);
      return toolText(`Answered ${question}.`);
    },
  );

  server.registerTool(
    "pause_goal",
    {
      description: `${PANE_ONLY} Pauses the session's goal, as /openplan pause.`,
      inputSchema: {},
    },
    async () => {
      const engine = session.current;
      if (!engine) return toolText(session.none);
      const { goal } = engine.state;
      if (goal.status !== "active") return toolText(`"${goal.name}" is ${goal.status} already.`);
      await engine.goals.pause();
      return toolText(`Paused "${goal.name}".`);
    },
  );

  server.registerTool(
    "resume_goal",
    {
      description: `${PANE_ONLY} Takes up the goal you picked in this session and resumes it, as /openplan resume.`,
      inputSchema: { goal: z.string().describe("The goal's slug") },
    },
    async ({ goal: slug }) => {
      const { goal } = (await session.takeUp(slug)).state;
      return toolText(`Resumed "${goal.name}".`);
    },
  );
}

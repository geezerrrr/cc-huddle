/**
 * The tools of openplan's pane (docs/design.md §7.2): where it reads the team
 * (`pane`, its socket), and how it answers what waits on you (`answer`).
 * They are the pane's, not your session's: the mod keeps the model from
 * calling them, so a permission is granted only by you, pressing its button.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Engine } from "../engine/engine.ts";
import type { Answer } from "../engine/questions.ts";
import { DECISION_OPTIONS, PERMISSION_OPTIONS } from "../engine/types.ts";
import { toolText } from "../engine/turns.ts";
import type { PaneServer } from "./pane-server.ts";
import { decisionOf } from "./tools.ts";

const PANE_ONLY = "For openplan's pane only: your session never calls it.";

/** Adds the pane's tools to `server`; `answer` opens the team first, if it isn't open (`team`). */
export function addPaneTools(server: McpServer, team: () => Promise<Engine>, pane: PaneServer) {
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
      await (await team()).answer(question, answer);
      return toolText(`Answered ${question}.`);
    },
  );
}

/**
 * The tools openplan's pane draws from and answers with (docs/design.md
 * §7.2). They are the pane's, not your session's: the mod keeps the model
 * from calling them, so a permission is granted only by you, pressing its
 * button.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { OpenplanView } from "../../plugin/types/index.d.ts";
import { workOf } from "../engine/core.ts";
import type { Engine } from "../engine/engine.ts";
import type { Answer } from "../engine/questions.ts";
import { DECISION_OPTIONS, PERMISSION_OPTIONS } from "../engine/types.ts";
import { paneTeam, shownMeeting } from "./pane.ts";
import { decisionOf } from "./tools.ts";

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

const PANE_ONLY = "For openplan's pane only: your session never calls it.";

/** Adds the pane's tools to `server`; each opens the team first, if it isn't open (`team`). */
export function addPaneTools(server: McpServer, team: () => Promise<Engine>) {
  server.registerTool(
    "view",
    {
      description: `${PANE_ONLY} The team as the pane draws it.`,
      inputSchema: {
        revision: z.number().int().optional().describe("The revision the pane has"),
        record: z
          .object({ subtask: z.string(), from: z.number().int().min(0) })
          .optional()
          .describe("The subtask whose record the pane follows, and the byte it read up to"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ revision, record }) => {
      const engine = await team();
      const work = workOf(engine);
      const meeting = shownMeeting(work);
      const spoken = meeting && engine.records.speaking(meeting);
      const view: OpenplanView = {
        revision: engine.revision,
        ...(revision !== engine.revision && { team: paneTeam(work, engine.team.members) }),
        ...(spoken && { speaking: { speaker: spoken.speaker, text: spoken.text } }),
        ...(record && {
          record: {
            subtask: record.subtask,
            ...(await engine.records.read(record.subtask, record.from)),
          },
        }),
      };
      return json(view);
    },
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
      return json({ answered: question });
    },
  );
}

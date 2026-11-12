/**
 * The tools openplan's pane draws from and answers with (docs/design.md
 * §7.2). They are the pane's, not your session's: the mod keeps the model
 * from calling them, so a permission is granted only by you, pressing its
 * button.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { workOf } from "../engine/core.ts";
import { derive } from "../engine/derive.ts";
import type { Engine } from "../engine/engine.ts";
import type { Answer } from "../engine/questions.ts";
import type { LiveRun, RecordEntry, Spoken } from "../engine/records.ts";
import {
  DECISION_OPTIONS,
  PERMISSION_OPTIONS,
  type Derived,
  type TeamState,
} from "../engine/types.ts";

/** The tools only the pane calls. */
export const PANE_TOOLS = ["view", "answer"] as const;

/** What `view` gives the pane. */
export interface PaneView {
  /** The state's revision: `team` comes only when it isn't the one the pane has. */
  revision: number;
  team?: {
    members: { name: string; role: string; model?: string }[];
    state: TeamState;
    derived: Derived;
  };
  /** The meeting turns being spoken now, by meeting id. */
  speaking: Record<string, Spoken>;
  /** The record of the subtask the pane follows, from where it last read. */
  record?: { subtask: string; entries: RecordEntry[]; next: number; live?: LiveRun };
}

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
      const { state } = engine;
      const view: PaneView = {
        revision: engine.revision,
        ...(revision !== engine.revision && {
          team: {
            members: engine.team.members.map((m) => ({
              name: m.name,
              role: m.role.title,
              ...(m.model && { model: m.model }),
            })),
            state,
            derived: derive(workOf(engine)),
          },
        }),
        speaking: Object.fromEntries(
          state.meetings.flatMap((m) => {
            const spoken = engine.records.speaking(m);
            return spoken ? [[m.id, spoken]] : [];
          }),
        ),
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
      const words = note ? { note } : {};
      const answer: Answer = option
        ? { option, ...words }
        : decision
          ? { decision, ...words, ...(sent_back !== undefined && { sentBack: sent_back }) }
          : { picks: picks ?? [] };
      await (await team()).answer(question, answer);
      return json({ answered: question });
    },
  );
}

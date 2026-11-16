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
import type { OpenplanAnswer, OpenplanCalls } from "../../plugin/types/index.d.ts";
import {
  DECISION_OPTIONS,
  PERMISSION_OPTIONS,
  type PermissionOption,
  SLUG,
  type GoalState,
  type Member,
} from "../engine/index.ts";

import type { PaneServer } from "./pane-server.ts";
import type { Session } from "./session.ts";

import { toolText } from "../shared/text.ts";
import { rosterOf } from "./words.ts";

const isPermission = (option: string): option is PermissionOption =>
  (PERMISSION_OPTIONS as readonly string[]).includes(option);

const PANE_ONLY = "For openplan's pane only: your session never calls it.";

const answerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("option"),
    option: z.enum([...PERMISSION_OPTIONS, ...DECISION_OPTIONS]),
    note: z.string().trim().optional().describe("Why it is denied, or what to change"),
    sentBack: z.string().optional().describe("The subtask a revised task goes back to"),
  }),
  z.object({
    kind: z.literal("choices"),
    picks: z.array(z.string()).describe("One pick per question with choices"),
  }),
]) satisfies z.ZodType<OpenplanAnswer>;

const answerInput = z.object({
  question: z.string(),
  answer: answerSchema,
}) satisfies z.ZodType<OpenplanCalls["answer"]>;

const handOffInput = z.object({ task: z.string().trim().min(1) }) satisfies z.ZodType<
  OpenplanCalls["hand_off"]
>;

const resumeInput = z.object({
  goal: z.string().regex(SLUG).describe("The goal's slug"),
}) satisfies z.ZodType<OpenplanCalls["resume_goal"]>;

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
      inputSchema: answerInput.shape,
    },
    async ({ question, answer }) => {
      await session.goal.answer(
        question,
        answer.kind === "choices"
          ? answer
          : isPermission(answer.option)
            ? { kind: "permission", option: answer.option, note: answer.note }
            : { ...answer, kind: "decision", option: answer.option },
      );
      return toolText(`Answered ${question}.`);
    },
  );

  server.registerTool(
    "hand_off",
    {
      description: `${PANE_ONLY} The prompt /openplan <task> gives the session: the task, for the team.`,
      inputSchema: handOffInput.shape,
      annotations: { readOnlyHint: true },
    },
    ({ task }) => {
      const engine = session.current;
      return toolText(
        handOffText(task, engine && { goal: engine.work.goal, members: engine.team.members }),
      );
    },
  );

  server.registerTool(
    "resume_goal",
    {
      description: `${PANE_ONLY} Takes up the goal you picked in this session and resumes it, as /openplan resume.`,
      inputSchema: resumeInput.shape,
    },
    async ({ goal: slug }) => {
      const { goal } = (await session.takeUp(slug)).work;
      return toolText(`Resumed "${goal.name}".`);
    },
  );
}

/**
 * What `/openplan <task>` gives your session: the task, for the team and not
 * for it, as the team skill says to take it on; with the team and the goal
 * this session runs (`mine`), if it runs one.
 */
function handOffText(
  task: string,
  mine: { goal: GoalState["goal"]; members: readonly Member[] } | undefined,
): string {
  const goal = mine
    ? `This session runs the goal "${mine.goal.name}", ${mine.goal.status === "active" ? "under way" : mine.goal.status}. The team: ${rosterOf(mine.members)}.`
    : "This session runs no goal yet.";
  return [
    "The user hands this to openplan's team: take it on as openplan's team skill says.",
    "",
    task,
    "",
    goal,
  ].join("\n");
}

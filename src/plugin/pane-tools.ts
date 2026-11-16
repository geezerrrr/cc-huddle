/**
 * The tools of cc-huddle's mod (docs/design.md §7.2, §7.3): where the pane
 * reads the team (`pane`, its socket), how it answers what waits on you
 * (`answer`, and `review_plan` for a plan), what `/huddle resume` does (`resume_goal`), the prompt
 * `/huddle <task>` gives your session (`hand_off`), and what `/huddle review`
 * and `/huddle meeting` switch (`switch_settings`). They are the mod's, not
 * your session's: the mod keeps the model from calling them, so a permission
 * is granted only by you, pressing its button, and a goal is taken up only on
 * your word.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { HuddleAnswer, HuddleCalls } from "../../plugin/types/index.d.ts";
import {
  DECISION_OPTIONS,
  type Goal,
  type GoalSettings,
  MEETING_SIZES,
  PERMISSION_OPTIONS,
  type PermissionOption,
  SLUG,
  type Member,
  writtenPlan,
} from "../engine/index.ts";

import type { PaneServer } from "./pane-server.ts";
import type { Session } from "./session.ts";

import { toolText } from "../shared/text.ts";
import { plural, rosterOf } from "./words.ts";

const isPermission = (option: string): option is PermissionOption =>
  (PERMISSION_OPTIONS as readonly string[]).includes(option);

const PANE_ONLY = "For cc-huddle's pane only: your session never calls it.";

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
]) satisfies z.ZodType<HuddleAnswer>;

const answerInput = z.object({
  question: z.string(),
  answer: answerSchema,
}) satisfies z.ZodType<HuddleCalls["answer"]>;

const reviewInput = z.object({
  meeting: z.string(),
  decision: z.enum(["approve", "drop", "change"]),
  accept: z.array(z.number().int().min(0)).optional().describe("The tasks you accept, by place"),
  change: z.string().trim().optional().describe("The change you want, as you typed it"),
}) satisfies z.ZodType<HuddleCalls["review_plan"]>;

const handOffInput = z.object({ task: z.string().trim().min(1) }) satisfies z.ZodType<
  HuddleCalls["hand_off"]
>;

const resumeInput = z.object({
  goal: z.string().regex(SLUG).describe("The goal's slug"),
}) satisfies z.ZodType<HuddleCalls["resume_goal"]>;

const settingsInput = z.object({
  review: z.boolean().optional(),
  meetingSize: z.enum(MEETING_SIZES).optional(),
}) satisfies z.ZodType<HuddleCalls["switch_settings"]>;

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
    "review_plan",
    {
      description: `${PANE_ONLY} Approves, drops or changes a plan out for review, as the user decided.`,
      inputSchema: reviewInput.shape,
    },
    async ({ meeting: id, decision, accept, change }) => {
      const { meetings } = session.goal;
      switch (decision) {
        case "drop":
          await meetings.cancel(id);
          return toolText("Dropped.");
        case "change":
          if (!change) throw new Error("Say what to change");
          return toolText(changeText(id, session.goal.work.goal.name, change));
        case "approve": {
          const plan = session.goal.work.meetings.find((m) => m.id === id)?.plan;
          if (accept && plan) {
            const written = writtenPlan(plan);
            meetings.change(id, {
              ...written,
              tasks: written.tasks.map((t, i) => ({ ...t, owner_accepts: accept.includes(i) })),
            });
          }
          const added = await meetings.approve(id);
          return toolText(
            `Approved: ${plural(added.length, "subtask goes", "subtasks go")} to work.`,
          );
        }
      }
    },
  );

  server.registerTool(
    "hand_off",
    {
      description: `${PANE_ONLY} The prompt /huddle <task> gives the session: the task, for the team.`,
      inputSchema: handOffInput.shape,
      annotations: { readOnlyHint: true },
    },
    async ({ task }) => {
      const engine = session.current;
      // With no goal yet, what is wrong with the team's files is said now, before your session proposes anything (§6).
      const members = engine ? engine.team.members : (await session.team()).members;
      return toolText(handOffText(task, engine?.work.goal, members));
    },
  );

  server.registerTool(
    "switch_settings",
    {
      description: `${PANE_ONLY} Switches review or the meeting size for this session's goal and goals started after, as /huddle review and /huddle meeting.`,
      inputSchema: settingsInput.shape,
    },
    async (change) => {
      const now = await session.switchSettings(change);
      return toolText(switchedText(change, now, session.current !== undefined));
    },
  );

  server.registerTool(
    "resume_goal",
    {
      description: `${PANE_ONLY} Takes up the goal you picked in this session and resumes it, as /huddle resume.`,
      inputSchema: resumeInput.shape,
    },
    async ({ goal: slug }) => {
      const { goal } = (await session.takeUp(slug)).work;
      return toolText(`Resumed "${goal.name}".`);
    },
  );
}

/**
 * What `/huddle <task>` gives your session: the task, for the team and not
 * for it, as the team skill says to take it on; with the goal this session
 * runs, if it runs one, and the team.
 */
function handOffText(task: string, goal: Goal | undefined, members: readonly Member[]): string {
  const runs = goal
    ? `This session runs the goal "${goal.name}", ${goal.status === "active" ? "under way" : goal.status}.`
    : "This session runs no goal yet.";
  return [
    "The user hands this to cc-huddle's team: take it on as cc-huddle's team skill says.",
    "",
    task,
    "",
    `${runs} The team: ${rosterOf(members)}.`,
  ].join("\n");
}

/**
 * What your session is given to change a plan with: your words for it, and
 * how; the changed plan is then asked of you again.
 */
function changeText(meeting: string, goal: string, change: string) {
  return [
    `The user wants the plan of the meeting [${meeting}] on "${goal}" changed:`,
    "",
    change,
    "",
    "Get it with show_plan, rewrite it with their words and change_plan. cc-huddle then asks them about the changed plan: don't ask them yourself.",
  ].join("\n");
}

/** What a switch of settings says: what it switched, and for which goals. */
function switchedText(change: Partial<GoalSettings>, now: GoalSettings, runsGoal: boolean) {
  const switched = [
    ...(change.review === undefined ? [] : [`Review is ${now.review ? "on" : "off"}`]),
    ...(change.meetingSize === undefined ? [] : [`Meetings are ${now.meetingSize}`]),
  ];
  return `${switched.join(", ")}: for ${runsGoal ? "this session's goal and " : ""}goals started after.`;
}

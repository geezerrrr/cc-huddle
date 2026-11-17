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
  parallel: z.boolean().optional(),
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
      await session.answer(
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
      description: `${PANE_ONLY} The prompt /huddle <task> gives the session: the task, for the team. Refused while the session's goal is under way.`,
      inputSchema: handOffInput.shape,
      annotations: { readOnlyHint: true },
    },
    async ({ task }) => {
      session.free();
      // The task is a new goal, with the team as its files have it now: what is wrong with them is said now, before your session proposes anything (§6).
      const { members } = await session.team();
      return toolText(handOffText(task, session.current?.work.goal, members));
    },
  );

  server.registerTool(
    "switch_settings",
    {
      description: `${PANE_ONLY} Switches the team's settings in your team.yaml, for this session's goal and goals started after, as /huddle review, /huddle meeting and /huddle parallel.`,
      inputSchema: settingsInput.shape,
    },
    async (change) => {
      const held = await session.switchSettings(change);
      return toolText(switchedText(change, held, session.current !== undefined));
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
    ? `It is a new goal: this session's goal "${goal.name}" is ${goal.status}, and starting the new one lets it go.`
    : "It is a new goal: this session runs none yet.";
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

/** A team setting as a switch names it: in `team.yaml`, and switched to `value`. */
const SETTING_WORDS: {
  [K in keyof GoalSettings]: { key: string; now: (value: GoalSettings[K]) => string };
} = {
  review: { key: "review", now: (on) => `Review is ${on ? "on" : "off"}` },
  meetingSize: { key: "meeting", now: (size) => `Meetings are ${size}` },
  parallel: { key: "parallel", now: (on) => `Parallel work is ${on ? "on" : "off"}` },
};

/** What a switch of settings says: what it switched, and for which goals; what the repository's team.yaml sets (`held`), to change there. */
function switchedText(
  change: Partial<GoalSettings>,
  held: readonly (keyof GoalSettings)[],
  runsGoal: boolean,
) {
  const said = (key: keyof GoalSettings) =>
    (SETTING_WORDS[key].now as (value: unknown) => string)(change[key]);
  const keys = (Object.keys(change) as (keyof GoalSettings)[]).filter(
    (key) => change[key] !== undefined,
  );
  const switched = keys.filter((key) => !held.includes(key)).map(said);
  return [
    ...(switched.length
      ? [
          `${switched.join(", ")}: for ${runsGoal ? "this session's goal and " : ""}goals started after.`,
        ]
      : []),
    ...held.map(
      (key) =>
        `The repository's .claude/huddle/team.yaml sets ${SETTING_WORDS[key].key}: change it there.`,
    ),
  ].join("\n");
}

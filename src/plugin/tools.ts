/**
 * The tools your session runs the team with (docs/design.md §7.3). Each does
 * one thing through the engine and says in a sentence what came of it; what
 * the engine refuses comes back as the tool's error, in its words. Questions
 * that need you yourself (a permission, a member's AskUserQuestion) are not
 * here: you answer those in the pane, with no model in between.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { workOf } from "../engine/core.ts";
import type { Engine } from "../engine/engine.ts";
import { goalBranch } from "../engine/git.ts";
import { planSchema } from "../engine/plan.ts";
import { derive } from "../engine/derive.ts";
import {
  DECISION_OPTIONS,
  GOAL_ACTIONS,
  MEETING_SIZES,
  SUBTASK_ACTIONS,
  type Goal,
  type Plan,
} from "../engine/types.ts";
import { statusText } from "./status.ts";

const said = (text: string) => ({ content: [{ type: "text" as const, text }] });

const names = (items: readonly string[]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(items);

/** A goal by its id, or by its name when no other goal has it. */
function goalOf(engine: Engine, ref: string): Goal {
  const { goals } = engine.state;
  const byId = goals.find((g) => g.id === ref);
  if (byId) return byId;
  const named = goals.filter((g) => g.name.toLowerCase() === ref.trim().toLowerCase());
  if (named.length === 1 && named[0]) return named[0];
  throw new Error(
    named.length
      ? `More than one goal is called "${ref}": give its id`
      : `There is no goal "${ref}"`,
  );
}

/** A plan in the shape change_plan takes. */
const writtenPlan = (plan: Plan) => ({
  summary: plan.summary,
  plan_markdown: plan.markdown,
  tasks: plan.tasks.map((task) => ({
    title: task.title,
    outcome: task.outcome,
    subtasks: task.subtasks.map(({ dependsOn, ...subtask }) => ({
      ...subtask,
      depends_on: dependsOn,
    })),
  })),
});

const goal = z.string().describe("The goal's id, or its name");
const meeting = z.string().describe("The meeting's id");
const subtask = z.string().describe("The subtask's id");

/** Adds the tools to `server`; each opens the team first, if it isn't open (`team`). */
export function addTools(server: McpServer, team: () => Promise<Engine>) {
  server.registerTool(
    "status",
    {
      description:
        "Where the team stands: each goal with its meetings, tasks and subtasks, who is busy, and what waits on the user. Ids are in brackets.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const engine = await team();
      return said(statusText(workOf(engine)));
    },
  );

  server.registerTool(
    "start_goal",
    {
      description:
        "Start a goal: something the user wants done. It gets its own branch, cut from the repository's HEAD. Then hold a meeting to plan it, or assign work directly.",
      inputSchema: { name: z.string().trim().min(1).describe("A few words for what is wanted") },
    },
    async ({ name }) => {
      const started = await (await team()).goals.start(name);
      return said(
        `Started the goal "${started.name}" [${started.id}] on branch ${goalBranch(started.slug)}.`,
      );
    },
  );

  server.registerTool(
    "hold_meeting",
    {
      description:
        "Have members meet to plan a goal. They discuss it read-only in the goal's worktree, and the host writes a plan of tasks and subtasks, each with an assignee, dependencies and acceptance criteria. Returns at once: the meeting runs in the background, and the session is told when its plan waits for the user.",
      inputSchema: {
        goal,
        agenda: z
          .string()
          .trim()
          .min(1)
          .describe("What to plan, with everything the user said about it"),
        size: z
          .enum(MEETING_SIZES)
          .optional()
          .describe("How long the discussion runs; the team's default when left out"),
        attendees: z
          .array(z.string())
          .default([])
          .describe("Member names, the host first; everyone when empty"),
      },
    },
    async ({ goal: ref, agenda, size, attendees }) => {
      const engine = await team();
      const held = engine.meetings.start({
        goalId: goalOf(engine, ref).id,
        agenda,
        size: size ?? engine.meetingSize,
        attendees,
      });
      return said(
        `The meeting [${held.id}] has begun: ${names(held.participants)}, hosted by ${held.host}.`,
      );
    },
  );

  server.registerTool(
    "show_plan",
    {
      description:
        "A meeting's plan in full: its document and its tasks and subtasks, in the shape change_plan takes.",
      inputSchema: { meeting },
      annotations: { readOnlyHint: true },
    },
    async ({ meeting: id }) => {
      const found = (await team()).state.meetings.find((m) => m.id === id);
      if (!found?.plan) throw new Error("That meeting has no plan");
      return said(JSON.stringify(writtenPlan(found.plan), null, 2));
    },
  );

  server.registerTool(
    "change_plan",
    {
      description:
        "Replace a plan under review with the user's changes: the whole plan, as show_plan gives it, changed. Any member can be given work.",
      inputSchema: {
        meeting,
        plan: planSchema(z.string().describe("The name of the member it goes to")),
      },
    },
    async ({ meeting: id, plan }) => {
      (await team()).meetings.change(id, plan);
      return said("The plan is changed. It waits for the user's approval.");
    },
  );

  server.registerTool(
    "approve_plan",
    {
      description:
        "Approve a plan under review, as the user said: its tasks and subtasks go to work, each starting once what it builds on is merged and its member is free.",
      inputSchema: { meeting },
    },
    async ({ meeting: id }) => {
      const added = await (await team()).meetings.approve(id);
      return said(
        `Approved: ${String(added.length)} ${added.length === 1 ? "subtask goes" : "subtasks go"} to work.`,
      );
    },
  );

  server.registerTool(
    "cancel_meeting",
    {
      description: "Stop a meeting under way, or drop a plan the user doesn't want.",
      inputSchema: { meeting },
    },
    async ({ meeting: id }) => {
      await (await team()).meetings.cancel(id);
      return said("Cancelled.");
    },
  );

  server.registerTool(
    "resume_meeting",
    {
      description:
        "Go on with a meeting that failed or was cancelled before its plan, from where it stopped.",
      inputSchema: { meeting },
    },
    async ({ meeting: id }) => {
      (await team()).meetings.resume(id);
      return said("The meeting goes on.");
    },
  );

  server.registerTool(
    "assign",
    {
      description:
        "Give a member one subtask directly, without a meeting. It starts once they are free.",
      inputSchema: {
        goal,
        assignee: z.string().describe("The member's name"),
        title: z.string().trim().min(1),
        description: z.string().trim().describe("Everything the user said about it"),
        acceptance: z.string().trim().default("").describe("When it counts as done"),
      },
    },
    async ({ goal: ref, ...work }) => {
      const engine = await team();
      const [added] = engine.goals.assign(goalOf(engine, ref).id, work);
      return said(`Assigned "${work.title}" [${added?.id ?? ""}] to ${work.assignee}.`);
    },
  );

  server.registerTool(
    "goal_action",
    {
      description:
        "Pause a goal (its runs stop, to go on later in their sessions), resume it, archive it, or delete an archived one: its worktrees and subtask branches go, its own branch stays. Delete only when the user has confirmed it.",
      inputSchema: { goal, action: z.enum(GOAL_ACTIONS) },
      annotations: { destructiveHint: true },
    },
    async ({ goal: ref, action }) => {
      const engine = await team();
      const { id, name } = goalOf(engine, ref);
      await engine.goals[action](id);
      return said(`The goal "${name}": ${action} done.`);
    },
  );

  server.registerTool(
    "subtask_action",
    {
      description:
        "Stop a subtask; continue a stopped or failed one in its session and worktree; retry one from the start; or redo a done one whose upstream was redone.",
      inputSchema: { subtask, action: z.enum(SUBTASK_ACTIONS) },
    },
    async ({ subtask: id, action }) => {
      const engine = await team();
      const found = engine.state.subtasks.find((s) => s.id === id);
      if (!found) throw new Error("There is no such subtask");
      if (!derive(workOf(engine)).subtasks[id]?.actions.includes(action))
        throw new Error(`"${found.title}" can't ${action} while ${found.status}`);
      await engine.scheduler[action](id);
      return said(`"${found.title}" is ${found.status} now.`);
    },
  );

  server.registerTool(
    "message",
    {
      description:
        "Pass the user's words to the member working on a subtask: a running one takes them at once, in its session; one not started reads them first.",
      inputSchema: { subtask, text: z.string().trim().min(1) },
    },
    async ({ subtask: id, text }) => {
      const went = (await team()).scheduler.carry(id, text);
      return said(
        went === "goes"
          ? "Passed on."
          : went === "handedOver"
            ? "Not passed on: it is delivered and in review or being merged. Send its task back once it is done."
            : "Not passed on: its goal is paused or archived.",
      );
    },
  );

  server.registerTool(
    "decide",
    {
      description:
        "Carry out the user's decision on something waiting on them: a task done (accept, or revise with what to change, `sent_back` naming the subtask), a stuck review (rereview, skip, sendBack), or a merge (ours, theirs, retry).",
      inputSchema: {
        question: z.string().describe("The id of what waits on the user"),
        decision: z.enum(DECISION_OPTIONS),
        note: z.string().trim().optional().describe("What to change, in the user's words"),
        sent_back: z.string().optional().describe("The subtask a revised task goes back to"),
      },
    },
    async ({ question, decision, note, sent_back }) => {
      await (
        await team()
      ).answer(question, {
        decision,
        ...(note !== undefined && { note }),
        ...(sent_back !== undefined && { sentBack: sent_back }),
      });
      return said("Done.");
    },
  );
}

/**
 * The tools your session runs the team with (docs/design.md §7.3). Each does
 * one thing through the engine and says in a sentence what came of it; what
 * the engine refuses comes back as the tool's error, in its words. Questions
 * that need you yourself (a permission, a member's AskUserQuestion) are not
 * here: you answer those in the pane, with no model in between.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  DECISION_OPTIONS,
  GOAL_ACTIONS,
  goalBranch,
  MEETING_SIZES,
  type Member,
  planSchema,
  SUBTASK_ACTIONS,
  type Team,
  writtenPlan,
} from "../engine/index.ts";

import type { HuddleCalls } from "../../plugin/types/index.d.ts";
import type { Session } from "./session.ts";
import { othersText, statusText } from "./status.ts";
import { attendanceText, plural, rosterOf, STATUS_WORDS } from "./words.ts";
import { toolText } from "../shared/text.ts";

const meeting = z.string().describe("The meeting's id");
const subtask = z.string().describe("The subtask's id");

const goalActionInput = z.object({ action: z.enum(GOAL_ACTIONS) }) satisfies z.ZodType<
  HuddleCalls["goal_action"]
>;

/** A member's name: any, until the team is read; then one of its members, each with their role (§7.3). */
function memberName(members?: readonly Member[]): z.ZodType<string> {
  if (!members) return z.string().trim().describe("A member's name");
  // A team has a member at least (team.ts loadTeam).
  const names = members.map((m) => m.name) as [string, ...string[]];
  return z.enum(names).describe(`One of the team: ${rosterOf(members)}`);
}

const meetingInput = (member: z.ZodType<string>) => ({
  agenda: z
    .string()
    .trim()
    .min(1)
    .describe(
      "What to plan: everything the user said about it, and what this conversation found out and settled about it",
    ),
  size: z
    .enum(MEETING_SIZES)
    .optional()
    .describe(
      "How long the discussion runs, only when the user asked for this meeting's own; the goal's when left out",
    ),
  attendees: z.array(member).default([]).describe("The host first; everyone when empty"),
  host_only: z
    .boolean()
    .default(false)
    .describe(
      "True when the host only runs the meeting: no view of their own and no work in the plan. Leave it out for a host who also takes part from their role, the usual",
    ),
});

const changePlanInput = (member: z.ZodType<string>) => ({ meeting, plan: planSchema(member) });

const assignInput = (member: z.ZodType<string>) => ({
  assignee: member,
  title: z.string().trim().min(1),
  description: z
    .string()
    .trim()
    .describe(
      "Everything the user said about it, and what this conversation found out and settled about it",
    ),
  acceptance: z.string().trim().default("").describe("When it counts as done"),
});

/**
 * On the tools a goal starts with: Claude Code loads their schemas upfront
 * instead of deferring them, so your session doesn't guess their arguments
 * (docs/design.md §7.3).
 */
const UPFRONT = { "anthropic/alwaysLoad": true };

/**
 * Adds the tools to `server`, all about the goal the session runs
 * (`session`). Returns what to call as the team they name is read, so the
 * tools that name a member list its members, and your session is told they
 * changed.
 */
export function addTools(server: McpServer, session: Session) {
  server.registerTool(
    "status",
    {
      description:
        "Where this session's goal stands: its meetings, tasks and subtasks, who is busy, and what waits on the user; and the repository's other goals. Ids are in brackets.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const engine = session.current;
      const others = othersText(await session.others());
      return toolText(
        [engine ? statusText(engine.work) : session.none, ...(others ? [others] : [])].join("\n\n"),
      );
    },
  );

  server.registerTool(
    "recommend",
    {
      description:
        "Before a goal starts: whether the user's task is better done by the team together or by one member solo, and who. It is judged in a session of its own that sees only the task, the team and the repository, read-only. Returns the recommendation and why; ask the user with it.",
      inputSchema: {
        task: z.string().trim().min(1).describe("The user's task, in their own words"),
      },
      annotations: { readOnlyHint: true },
      _meta: UPFRONT,
    },
    async ({ task }, { signal }) => {
      const { way, members, why } = await session.recommend(task, signal);
      const who = members.join(", ");
      return toolText(
        way === "together"
          ? `Recommended: the team together, ${who}, the first hosting. Why: ${why}`
          : `Recommended: ${who} solo. Why: ${why}`,
      );
    },
  );

  server.registerTool(
    "start_goal",
    {
      description:
        "Start a goal in this session: something the user wants done. It gets its own branch, cut from the branch the user's checkout is on, which it merges its work back into once done and the user agrees, and its own copy of the team. A session runs one goal: refused while its goal is under way. Then plan it once: a meeting of the members the user picked, or, with one picked, the task assigned to them. Nothing is added to a goal after.",
      inputSchema: { name: z.string().trim().min(1).describe("A few words for what is wanted") },
      _meta: UPFRONT,
    },
    async ({ name }) => {
      const { goal } = (await session.start(name)).work;
      return toolText(`Started the goal "${goal.name}" on branch ${goalBranch(goal.slug)}.`);
    },
  );

  const meetingTool = server.registerTool(
    "hold_meeting",
    {
      description:
        "Have members meet to plan a goal. They discuss it read-only in the goal's worktree, and the host writes a plan of tasks and subtasks, each with an assignee, dependencies and acceptance criteria. Returns at once: the meeting runs in the background, and cc-huddle asks the user about its plan when it is ready. A goal has one meeting, held as it starts; hold it only once the user has picked who attends.",
      inputSchema: meetingInput(memberName()),
      _meta: UPFRONT,
    },
    ({ agenda, size, attendees, host_only }) => {
      const engine = session.goal;
      const held = engine.meetings.start({
        agenda,
        size: size ?? engine.work.goal.settings.meetingSize,
        attendees,
        hostOnly: host_only,
      });
      return toolText(`The meeting [${held.id}] has begun: ${attendanceText(held)}.`);
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
    ({ meeting: id }) => {
      const found = session.goal.work.meetings.find((m) => m.id === id);
      if (!found?.plan) throw new Error("That meeting has no plan");
      return toolText(JSON.stringify(writtenPlan(found.plan), null, 2));
    },
  );

  const changePlanTool = server.registerTool(
    "change_plan",
    {
      description:
        "Replace a plan under review with the user's changes: the whole plan, as show_plan gives it, changed. Any member can be given work. owner_accepts marks a task the user accepts themselves once done; none is, unless they say.",
      inputSchema: changePlanInput(memberName()),
    },
    ({ meeting: id, plan }) => {
      session.goal.meetings.change(id, plan);
      return toolText("The plan is changed. It waits for the user's approval.");
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
      const added = await session.goal.meetings.approve(id);
      return toolText(`Approved: ${plural(added.length, "subtask goes", "subtasks go")} to work.`);
    },
  );

  server.registerTool(
    "cancel_meeting",
    {
      description: "Stop a meeting under way, or drop a plan the user doesn't want.",
      inputSchema: { meeting },
    },
    async ({ meeting: id }) => {
      await session.goal.meetings.cancel(id);
      return toolText("Cancelled.");
    },
  );

  server.registerTool(
    "resume_meeting",
    {
      description:
        "Go on with a meeting that failed or was cancelled before its plan, from where it stopped.",
      inputSchema: { meeting },
    },
    ({ meeting: id }) => {
      session.goal.meetings.resume(id);
      return toolText("The meeting goes on.");
    },
  );

  const assignTool = server.registerTool(
    "assign",
    {
      description:
        "Give the goal's task to the one member the user picked, without a meeting, as the goal starts: a goal is planned once. Assign only once the user has picked them.",
      inputSchema: assignInput(memberName()),
      _meta: UPFRONT,
    },
    (work) => {
      const added = session.goal.scheduler.assignOne(work);
      return toolText(`Assigned "${work.title}" [${added.id}] to ${work.assignee}.`);
    },
  );

  server.registerTool(
    "goal_action",
    {
      description:
        "Pause this session's goal (its runs stop, to go on later in their sessions), resume it, archive it, or delete it once archived or closed: its folder, worktrees and subtask branches go, and its own branch stays unless it is closed (merged back by then). Delete only when the user has confirmed it.",
      inputSchema: goalActionInput.shape,
      annotations: { destructiveHint: true },
    },
    async ({ action }) => {
      const engine = session.goal;
      const { name } = engine.work.goal;
      if (action === "delete") await session.delete();
      else await engine.goals[action]();
      return toolText(`The goal "${name}": ${action} done.`);
    },
  );

  server.registerTool(
    "subtask_action",
    {
      description:
        "Stop a subtask; continue a stopped or failed one in its session and worktree; or retry one from the start.",
      inputSchema: { subtask, action: z.enum(SUBTASK_ACTIONS) },
    },
    async ({ subtask: id, action }) => {
      const engine = session.goal;
      const acted = await engine.scheduler.act(id, action);
      return toolText(`"${acted.title}" is ${STATUS_WORDS[acted.status]} now.`);
    },
  );

  server.registerTool(
    "decide",
    {
      description:
        "Carry out the user's decision on something waiting on them: a task done (accept, or revise with what to change, `sent_back` naming the subtask; where it is all the goal waits on: acceptMerge, acceptOnly, revise), a stuck review (rereview, skip, sendBack; one that failed goes back only with a note), a merge (ours, theirs, retry; one git failed on: retry, stop), the goal's work to merge back into its branch (merge, or notNow, which pauses it), or a closed goal (cleanUp deletes it with its worktree and branch, keep). Only as the user decided.",
      inputSchema: {
        question: z.string().describe("The id of what waits on the user"),
        decision: z.enum(DECISION_OPTIONS),
        note: z.string().trim().optional().describe("What to change, in the user's words"),
        sent_back: z.string().optional().describe("The subtask a revised task goes back to"),
      },
    },
    async ({ question, decision, note, sent_back }) => {
      await session.answer(question, {
        kind: "decision",
        option: decision,
        note,
        sentBack: sent_back,
      });
      return toolText("Done.");
    },
  );

  return ({ members }: Team) => {
    const member = memberName(members);
    meetingTool.update({ paramsSchema: meetingInput(member) });
    changePlanTool.update({ paramsSchema: changePlanInput(member) });
    assignTool.update({ paramsSchema: assignInput(member) });
  };
}

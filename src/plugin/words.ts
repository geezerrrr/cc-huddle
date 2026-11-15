/**
 * The words openplan puts things in, once each: what your session reads
 * (status.ts), the pane, the band and the question dialog (pane.ts) all say a
 * thing the same way, from here.
 */
import {
  type DecisionOption,
  type GoalEntry,
  type GoalState,
  hostOf,
  type Meeting,
  type MeetingNow,
  type Member,
  type NoteOption,
  type Notice,
  type Permission,
  type PermissionOption,
  type QuestionToYou,
  type Subtask,
  type SubtaskStatus,
  type Wait,
  type Work,
} from "../engine/index.ts";
import { listOf } from "../shared/text.ts";

export const plural = (n: number, one: string, many: string) =>
  `${String(n)} ${n === 1 ? one : many}`;

/** A meeting whose plan waits for you, as a goal's progress and the band put it. */
export const PLAN_TO_REVIEW = "plan to review";

/** The team, each member with their role. */
export const rosterOf = (members: readonly Member[]) =>
  members.map((m) => `${m.name} (${m.role.title})`).join(", ");

/** Who hosts a meeting: "hosted by ann", ", who only runs it" for a host who does. */
export const hostText = (meeting: Pick<Meeting, "participants" | "hostOnly">) =>
  `hosted by ${hostOf(meeting)}${meeting.hostOnly ? ", who only runs it" : ""}`;

/** Who is at a meeting: everyone at it, and who hosts it. */
export const attendanceText = (meeting: Pick<Meeting, "hostOnly" | "participants">) =>
  `${listOf(meeting.participants)}, ${hostText(meeting)}`;

/** What the Agent SDK reported while a run went on, in words. */
export function noticeText(notice: Notice): string {
  const seconds = (ms: number) => `${String(Math.round(ms / 1000))}s`;
  switch (notice.kind) {
    case "retry":
      return `the API call failed: attempt ${String(notice.attempt)} of ${String(notice.max)} in ${seconds(notice.delayMs)}`;
    case "subagent-retry":
      return `a subagent's API call failed: attempt ${String(notice.attempt)} of ${String(notice.max)} in ${seconds(notice.delayMs)}`;
    case "compacted":
      return `the conversation was compacted from ${notice.before.toLocaleString()} tokens${notice.after === undefined ? "" : ` to ${notice.after.toLocaleString()}`}`;
    case "compaction-failed":
      return `compacting the conversation failed${notice.error ? `: ${notice.error}` : ""}`;
    case "fallback":
      return `${notice.from} declined: ${notice.to} goes on`;
    case "refusal":
      return `${notice.model} declined, with no model to go on`;
    case "task":
      return `background task "${notice.title}" ${notice.state}`;
    case "rate-limit":
      return notice.status === "rejected" ? "rate limited" : "close to the rate limit";
  }
}

/** What a subtask waits on, in words. */
export function waitText(wait: Wait, work: Work): string {
  switch (wait.kind) {
    case "goal":
      return `its goal is ${wait.status}`;
    case "upstream": {
      const upstream = work.subtasks.find((s) => s.id === wait.subtaskId);
      return `waits on "${upstream?.title ?? ""}" by ${wait.by}${wait.halted ? ", which has stopped" : ""}`;
    }
    case "busy":
      return `waits until ${wait.by} is free`;
    case "after": {
      const first = work.subtasks.find((s) => s.id === wait.subtaskId);
      return `waits for "${first?.title ?? ""}" to go on first`;
    }
    case "merge": {
      const ahead = work.subtasks.find((s) => s.id === wait.subtaskId);
      return `waits until "${ahead?.title ?? ""}" is merged`;
    }
    case "teammate":
      return `asked ${wait.by}`;
    case "you":
      return wait.decision ? "waits on your decision" : "waits on your answer";
    case "acceptance":
      return "waits until you accept the task it builds on";
  }
}

/** A subtask's status, in words. */
export const STATUS_WORDS: Record<SubtaskStatus, string> = {
  pending: "pending",
  running: "running",
  reviewing: "in review",
  merging: "being merged",
  done: "done",
  failed: "failed",
  stopped: "stopped",
  stoppedInReview: "stopped in review",
  stoppedInMerge: "stopped while merging",
};

/** That a done subtask is built on work redone since, `titles` that work. */
export const redoneText = (titles: readonly string[]) =>
  `built on ${titles.map((t) => `"${t}"`).join(", ")}, redone since: redo it to take that in`;

/** Where a running subtask is: "step 2 of 3: Write the reroll"; nothing before its steps are known. */
export function stepText({ done, total, current }: Subtask["progress"]): string | undefined {
  if (!total) return undefined;
  const step = `step ${String(Math.min(done + 1, total))} of ${String(total)}`;
  return current ? `${step}: ${current}` : step;
}

/** A subtask under way: worked on, in review, or being merged. */
export type UnderWay = Subtask & { status: "running" | "reviewing" | "merging" };

export const isUnderWay = (subtask: Subtask): subtask is UnderWay =>
  subtask.status === "running" || subtask.status === "reviewing" || subtask.status === "merging";

/** A subtask under way, in words: worked on and how far, in review, or being merged. */
export function underWay(subtask: UnderWay): string {
  switch (subtask.status) {
    case "running": {
      const step = stepText(subtask.progress);
      return `works on "${subtask.title}"${step ? `, ${step}` : ""}`;
    }
    case "reviewing":
      return `"${subtask.title}" in review`;
    case "merging":
      return `"${subtask.title}" being merged`;
  }
}

/**
 * Where a meeting is, in words: who speaks, the plan being written or
 * waiting for you, how it ended. `now`: what goes on at it, while it runs.
 */
export function meetingStatus(meeting: Meeting, now: MeetingNow | undefined): string {
  switch (meeting.status) {
    case "running":
      return now?.speaking?.planning
        ? `${now.speaking.member} writes the plan`
        : now?.speaking
          ? `${now.speaking.member} speaks`
          : now?.together === "drafting"
            ? "the members form their first judgments"
            : now?.together === "weighing"
              ? "deciding who speaks next"
              : "under way";
    case "review":
      return "its plan waits for you";
    case "approved":
      return "plan approved";
    case "cancelled":
      return "cancelled";
    case "dropped":
      return "its plan dropped";
    case "failed":
      return `failed${meeting.error ? `: ${meeting.error}` : ""}`;
  }
}

/** The input a tool call's line names it by: the command, the file, the pattern… */
const MAIN_ARGUMENTS = ["command", "file_path", "path", "pattern", "url", "description"];

/** A tool call's main argument, the one its line shows. */
export function mainArgument(input: unknown): string | undefined {
  const fields = (input ?? {}) as Record<string, unknown>;
  return MAIN_ARGUMENTS.map((key) => fields[key]).find(
    (value): value is string => typeof value === "string",
  );
}

/** A tool call in a line: the tool and its main argument. */
function callText(permission: Permission): string {
  const main = mainArgument(permission.input);
  return main ? `${permission.tool}: ${main}` : permission.tool;
}

/** What each answer to a permission or a decision is called. */
export const OPTION_LABELS: Record<PermissionOption | DecisionOption, string> = {
  once: "Allow once",
  always: "Always allow",
  deny: "Deny",
  rereview: "Review again",
  skip: "Skip the review",
  sendBack: "Send back",
  ours: "Keep ours",
  theirs: "Take theirs",
  retry: "Retry",
  stop: "Stop",
  accept: "Accept",
  revise: "Send back",
};

/** What a note typed instead of a pick says, for the option it goes with. */
export const NOTE_PROMPTS: Record<NoteOption, string> = {
  deny: "Or deny it, saying why",
  sendBack: "Or send it back, saying what to change",
  revise: "What to change",
};

/**
 * What waits on you, in a sentence (`headline`), and more of it where there
 * is (`detail`): a stuck review's notes, the files a merge can't take.
 */
export function needWords(
  question: QuestionToYou,
  work: Work,
): { headline: string; detail?: string } {
  const title = work.subtasks.find((s) => s.id === question.subtaskId)?.title;
  const about = title ? ` for "${title}"` : "";
  switch (question.kind) {
    case "permission":
      return {
        headline: `${question.from} asks to use ${callText(question.permission)}${about}. Allow it?`,
        ...(question.text && { detail: question.text }),
      };
    case "choices":
      return { headline: `${question.from} asks${about}:` };
    case "decision":
      switch (question.decision.kind) {
        case "review":
          return {
            headline: `The review of "${title ?? ""}" is stuck. What now?`,
            detail: question.text,
          };
        case "merge":
          return {
            headline: `Merging "${title ?? ""}" needs you. What now?`,
            detail: question.text.split("\n").join(", "),
          };
        case "delivery":
          return { headline: `The task "${question.text}" is done. Accept it?` };
      }
  }
}

/** Where a goal is: in another session, archived, or paused, as a session that ended left it too; or unreadable here. */
export const whereOf = (entry: GoalEntry) =>
  entry.holder
    ? "in another session"
    : !("state" in entry)
      ? "unreadable"
      : entry.state.goal.status === "archived"
        ? "archived"
        : "paused";

/** How far a goal got, in words. */
function progressOf({ subtasks, meetings }: Pick<GoalState, "subtasks" | "meetings">): string {
  const done = subtasks.filter((s) => s.status === "done").length;
  return subtasks.length
    ? `${String(done)}/${String(subtasks.length)} subtasks done`
    : meetings.some((m) => m.status === "review")
      ? PLAN_TO_REVIEW
      : "no plan yet";
}

/** A goal named with how far it got and `where` it is, as `/openplan resume` lists it. */
export const goalLabel = (state: GoalState, where: string) =>
  `${state.goal.name} · ${progressOf(state)} · ${where}`;

/** One of the repository's goals as `/openplan resume` lists it: one that can't be read by its folder, and why. */
export const entryLabel = (entry: GoalEntry) =>
  "state" in entry
    ? goalLabel(entry.state, whereOf(entry))
    : `${entry.slug} · can't be read: ${entry.unreadable}`;

/**
 * Why a session runs no goal, and what to do, as the pane says it: `moved`,
 * the goal that moved to another session.
 */
export const noGoalText = (moved: string | undefined) =>
  moved
    ? `"${moved}" moved to another Claude Code session. Bring it back here with /openplan resume.`
    : "This session runs no goal. Hand the team a task with /openplan <task>, or take a goal up with /openplan resume.";

/** Why a session runs no goal, and what to do, as its model is told: `moved`, the goal that moved to another session. */
export const noGoalForModel = (moved: string | undefined) =>
  moved
    ? `The goal "${moved}" moved to another Claude Code session. The user brings it back with /openplan resume.`
    : "This session runs no goal: start one (start_goal), or the user takes one up with /openplan resume.";

/**
 * What `/openplan <task>` gives your session: the task, for the team and not
 * for it, as the team skill says to take it on; with the team and the goal
 * this session runs (`mine`), if it runs one.
 */
export function handOffText(
  task: string,
  mine: { goal: GoalState["goal"]; members: readonly Member[] } | undefined,
): string {
  const goal = mine
    ? `This session runs the goal "${mine.goal.name}", ${mine.goal.status === "active" ? "under way" : mine.goal.status}. The team: ${rosterOf(mine.members)}.`
    : "This session runs no goal yet.";
  return [
    "The user hands this to openplan's team: take it on as openplan's team skill says, and don't do any of it yourself.",
    "",
    task,
    "",
    goal,
  ].join("\n");
}

/** Why `/openplan resume` takes nothing up while this session's goal (`name`) is under way. */
export const resumeRefusal = (name: string) =>
  `"${name}" is under way in this session, which runs one goal: /openplan pause it first, or take the other up in another session.`;

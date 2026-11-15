/**
 * The words openplan puts things in, once each: what your session reads
 * (status.ts), the pane, the band and the question dialog (pane.ts) all say a
 * thing the same way, from here.
 */
import type { GoalEntry } from "../engine/data.ts";
import type { Work } from "../engine/derive.ts";
import type {
  DecisionOption,
  GoalState,
  Member,
  Meeting,
  Permission,
  PermissionOption,
  QuestionToYou,
  Subtask,
  Wait,
} from "../engine/types.ts";

export const plural = (n: number, one: string, many: string) =>
  `${String(n)} ${n === 1 ? one : many}`;

/** A meeting whose plan waits for you, as a goal's progress and the band put it. */
export const PLAN_TO_REVIEW = "plan to review";

/** The team, each member with their role. */
export const rosterOf = (members: readonly Member[]) =>
  members.map((m) => `${m.name} (${m.role.title})`).join(", ");

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

/** Where a running subtask is: "step 2 of 3: Write the reroll"; nothing before its steps are known. */
export function stepText({ done, total, current }: Subtask["progress"]): string | undefined {
  if (!total) return undefined;
  const step = `step ${String(Math.min(done + 1, total))} of ${String(total)}`;
  return current ? `${step}: ${current}` : step;
}

/**
 * A subtask under way, in words: worked on and how far, in review, or being
 * merged; undefined for one that isn't under way.
 */
export function underWay(subtask: Subtask): string | undefined {
  switch (subtask.status) {
    case "running": {
      const step = stepText(subtask.progress);
      return `works on "${subtask.title}"${step ? `, ${step}` : ""}`;
    }
    case "reviewing":
      return `"${subtask.title}" in review`;
    case "merging":
      return `"${subtask.title}" being merged`;
    default:
      return undefined;
  }
}

/** Where a meeting is, in words: who speaks, the plan being written or waiting for you, how it ended. */
export function meetingStatus(meeting: Meeting): string {
  switch (meeting.status) {
    case "running":
      return meeting.planning
        ? `${meeting.host} writes the plan`
        : meeting.speaking
          ? `${meeting.speaking} speaks`
          : meeting.drafting
            ? "the members form their first judgments"
            : meeting.weighing
              ? "deciding who speaks next"
              : "under way";
    case "review":
      return "its plan waits for you";
    case "approved":
      return "plan approved";
    case "cancelled":
      return "cancelled";
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
export const NOTE_PROMPTS: Partial<Record<PermissionOption | DecisionOption, string>> = {
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

/** Where a goal is: in another session, archived, or paused, as a session that ended left it too. */
export const whereOf = (entry: GoalEntry) =>
  entry.holder
    ? "in another session"
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

/**
 * Why a session runs no goal, and what to do, as the pane says it: `moved`,
 * the goal that moved to another session.
 */
export const noGoalText = (moved: string | undefined) =>
  moved
    ? `"${moved}" moved to another Claude Code session. Bring it back here with /openplan resume.`
    : "This session runs no goal. Hand the team a task with /openplan <task>, or take a goal up with /openplan resume.";

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

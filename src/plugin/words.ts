/**
 * The words openplan puts things in, once each: what your session reads
 * (status.ts), the pane, the band and the question dialog (pane.ts) all say a
 * thing the same way, from here.
 */
import {
  type GoalEntry,
  type GoalState,
  hostOf,
  type Meeting,
  type MeetingNow,
  type Member,
  type Permission,
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
      return wait.decision ? "waits for a decision" : "waits for an answer";
    case "acceptance":
      return "waits until the task it builds on is accepted";
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

/** Where a running subtask is: "step 2 of 3: Write the reroll"; nothing before its steps are known. */
export function stepText({ done, total, current }: Subtask["progress"]): string | undefined {
  if (!total) return undefined;
  const step = `step ${String(Math.min(done + 1, total))} of ${String(total)}`;
  return current ? `${step}: ${current}` : step;
}

/**
 * Where a meeting is, in words: who speaks, the plan being written or
 * waiting for review, how it ended. `now`: what goes on at it, while it runs.
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
      return "its plan waits for review";
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
            headline: `Merging "${title ?? ""}" is stuck. What now?`,
            detail: question.text.split("\n").join(", "),
          };
        case "delivery":
          return { headline: `The task "${question.text}" is done. Accept it?` };
      }
  }
}

/** Where one of the repository's goals is: in another session, unreadable, archived, or paused, as a session that ended left it too. */
type GoalWhere = "elsewhere" | "unreadable" | "archived" | "paused";

export const whereOf = (entry: GoalEntry): GoalWhere =>
  entry.holder
    ? "elsewhere"
    : !("state" in entry)
      ? "unreadable"
      : entry.state.goal.status === "archived"
        ? "archived"
        : "paused";

const WHERE_WORDS: Record<GoalWhere, string> = {
  elsewhere: "in another session",
  unreadable: "can't be read",
  archived: "archived",
  paused: "paused",
};

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
const entryLabel = (entry: GoalEntry) =>
  "state" in entry
    ? goalLabel(entry.state, WHERE_WORDS[whereOf(entry)])
    : `${entry.slug} · ${WHERE_WORDS.unreadable}: ${entry.unreadable}`;

/** The repository's goals a session doesn't run, each named with how far it got and where it is, for `/openplan resume`. */
export const resumableOf = (others: readonly GoalEntry[]): { slug: string; label: string }[] =>
  others.map((entry) => ({ slug: entry.slug, label: entryLabel(entry) }));

/**
 * A goal as it stands, in words (docs/design.md §7.2): what your session
 * reads from the `status` tool and the SessionStart hook, and what
 * `/openplan status` prints. Ids are given in brackets, for the tools.
 */
import {
  derive,
  type Derived,
  goalBranch,
  type GoalEntry,
  type QuestionToYou,
  type Subtask,
  toYou,
  type Work,
} from "../engine/index.ts";
import {
  hostText,
  meetingStatus,
  needWords,
  redoneText,
  resumableOf,
  stepText,
  waitText,
  STATUS_WORDS,
} from "./words.ts";

/** A subtask on one line: its status, how far it is, what it waits on, what it is built on that was redone, what went wrong. */
function subtaskLine(
  subtask: Subtask,
  { waits, redone }: Derived["subtasks"][string],
  work: Work,
): string {
  const parts: string[] = [STATUS_WORDS[subtask.status]];
  const step = subtask.status === "running" && stepText(subtask.progress);
  if (step) parts.push(step);
  parts.push(...waits.map((w) => waitText(w, work)));
  if (redone.length)
    parts.push(redoneText(redone.map((id) => work.subtasks.find((s) => s.id === id)?.title ?? "")));
  if (subtask.error) parts.push(`error: ${subtask.error}`);
  return `    - ${subtask.title} [${subtask.id}], ${subtask.assignee}: ${parts.join(", ")}`;
}

/** A question put to you, in words: a decision with the options `decide` takes. */
function questionLine(question: QuestionToYou, work: Work): string {
  const { headline, detail } = needWords(question, work);
  const asks =
    question.kind === "choices" ? ` ${question.choices.map((c) => c.question).join(" ")}` : "";
  const then =
    question.kind === "decision"
      ? ` Options: ${question.decision.options.join(", ")}.`
      : " Answered in /openplan.";
  return `  - [${question.id}] ${headline}${asks}${detail ? ` (${detail})` : ""}${then}`;
}

/** The session's goal with its team, meetings and work, and what waits on you. */
export function statusText(work: Work): string {
  const derived = derive(work);
  const busy = new Set(derived.busy);
  const { goal } = work;
  const lines = [
    `Goal "${goal.name}": ${goal.status}, on branch ${goalBranch(goal.slug)}`,
    `Team: ${work.members.map((m) => (busy.has(m) ? `${m} (busy)` : m)).join(", ")}`,
  ];
  for (const meeting of work.meetings.filter((m) => m.status !== "approved"))
    lines.push(
      `  Meeting [${meeting.id}], ${hostText(meeting)}: ${meetingStatus(meeting, work.meetingsNow[meeting.id])}${derived.resumable.includes(meeting.id) ? "; it can go on" : ""}`,
    );
  for (const task of work.tasks) {
    lines.push(
      `  Task "${task.title}" [${task.id}]${task.ownerAccepts ? ", accepted by the user" : ""}`,
    );
    for (const subtask of work.subtasks.filter((s) => s.taskId === task.id))
      lines.push(
        subtaskLine(subtask, derived.subtasks[subtask.id] ?? { waits: [], redone: [] }, work),
      );
  }
  const open = work.questions.filter(toYou);
  if (open.length)
    lines.push("", "Waiting for answers:", ...open.map((q) => questionLine(q, work)));
  return lines.join("\n");
}

/** The repository's goals a session doesn't run, a line each; undefined when there are none. */
export function othersText(others: readonly GoalEntry[]): string | undefined {
  if (!others.length) return undefined;
  return [
    "The repository's other goals, taken up here with /openplan resume:",
    ...resumableOf(others).map((o) => `  - ${o.label}`),
  ].join("\n");
}

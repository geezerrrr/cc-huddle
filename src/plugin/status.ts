/**
 * The team as it stands, in words (docs/design.md §7.2): what your session
 * reads from the `status` tool and the SessionStart hook, and what
 * `/openplan status` prints. Ids are given in brackets, for the tools.
 */
import { derive, type Work } from "../engine/derive.ts";
import { goalBranch } from "../engine/git.ts";
import {
  toYou,
  type Meeting,
  type QuestionToYou,
  type Subtask,
  type Wait,
} from "../engine/types.ts";

const MEETING_STATUS: Record<Meeting["status"], string> = {
  running: "under way",
  review: "its plan waits for you: approve it, change it, or cancel it",
  approved: "plan approved",
  cancelled: "cancelled",
  failed: "failed",
};

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

/** A subtask on one line: its status, how far it is, what it waits on, what went wrong. */
function subtaskLine(subtask: Subtask, waits: Wait[], work: Work): string {
  const parts: string[] = [subtask.status];
  const step = subtask.status === "running" && stepText(subtask.progress);
  if (step) parts.push(step);
  parts.push(...waits.map((w) => waitText(w, work)));
  if (subtask.error) parts.push(`error: ${subtask.error}`);
  return `    - ${subtask.title} [${subtask.id}], ${subtask.assignee}: ${parts.join(", ")}`;
}

/** A question put to you, in words. */
function questionLine(question: QuestionToYou, work: Work): string {
  const about = work.subtasks.find((s) => s.id === question.subtaskId);
  const head = `  - [${question.id}] `;
  if (question.kind === "permission")
    return `${head}${question.from} asks to use ${question.permission.tool}${question.permission.title ? `: ${question.permission.title}` : ""}. Answer it in /openplan.`;
  if (question.kind === "choices")
    return `${head}${question.from} asks: ${question.choices.map((c) => c.question).join(" ")} Answer it in /openplan.`;
  const options = question.decision.options.join(", ");
  switch (question.decision.kind) {
    case "delivery":
      return `${head}The task "${question.text}" is done: ${options}.`;
    case "review":
      return `${head}The review of "${about?.title ?? ""}" is stuck (${question.text}): ${options}.`;
    case "merge":
      return `${head}Merging "${about?.title ?? ""}" needs you (${question.text.split("\n").join(", ")}): ${options}.`;
  }
}

/** The team, each goal with its meetings and work, and what waits on you. */
export function statusText(work: Work): string {
  const derived = derive(work);
  const busy = new Set(derived.busy);
  const lines = [`Team: ${work.members.map((m) => (busy.has(m) ? `${m} (busy)` : m)).join(", ")}`];
  for (const goal of work.goals) {
    lines.push(
      "",
      `Goal "${goal.name}" [${goal.id}]: ${goal.status}, on branch ${goalBranch(goal.slug)}`,
    );
    for (const meeting of work.meetings.filter(
      (m) => m.goalId === goal.id && m.status !== "approved",
    ))
      lines.push(
        `  Meeting [${meeting.id}] on "${meeting.agenda}", hosted by ${meeting.host}: ${MEETING_STATUS[meeting.status]}${meeting.error ? ` (${meeting.error})` : ""}${derived.resumable.includes(meeting.id) ? "; it can go on" : ""}`,
      );
    for (const task of work.tasks.filter((t) => t.goalId === goal.id)) {
      lines.push(`  Task "${task.title}" [${task.id}]`);
      for (const subtask of work.subtasks.filter((s) => s.taskId === task.id))
        lines.push(subtaskLine(subtask, derived.subtasks[subtask.id]?.waits ?? [], work));
    }
  }
  const open = work.questions.filter(toYou).filter((q) => q.status === "open");
  if (open.length) lines.push("", "Waiting on you:", ...open.map((q) => questionLine(q, work)));
  return lines.join("\n");
}

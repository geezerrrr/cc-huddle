/**
 * Every prompt the engine sends (docs/design.md §3.1), in one module. Only
 * models read them, so they are in English.
 */
import type { Delivery, Goal, GoOn, Member, Subtask, Task } from "./types.ts";

/** The kinds of session a member works in. */
export type SessionKind = "task" | "answer" | "review";

/** A member by name and role, as their teammates know them. */
const called = (member: Member) => `${member.name} (${member.role.title})`;

const TASK_WAYS = `# How you work on a subtask
- You work in a git worktree of your own, on a branch cut from the goal's branch, which is merged into the goal's branch once you deliver. Teammates working at the same time each have theirs, so you never get in each other's way. Stay in yours.
- Commit as you go if you like; whatever is uncommitted when you deliver is committed for you.
- When you need information or a decision from a teammate (an interface, a design detail), ask them with ask_teammate. It waits for their answer.
- When you need the user to decide something or give you what only they have, ask with AskUserQuestion, offering options, and wait for the answer. Don't just write that you are waiting: the user may not be watching.
- When you are done, call deliver with a summary of a few sentences (what you did, anything to watch out for) and the files that are the result. Your subtask isn't done until you deliver; then end your turn.`;

/** What is appended to Claude Code's system prompt for a member's session: who they are, and how to work. */
export function systemPrompt(kind: SessionKind, member: Member, team: readonly Member[]): string {
  const others = team.filter((m) => m.name !== member.name).map(called);
  const who = `# Who you are
You are ${member.name}, the ${member.role.title} on a team of Claude Code sessions working on this repository. Each member is a session of its own, often on another model. The user directs the team from their own Claude Code session.
${others.length ? `Your teammates: ${others.join(", ")}.` : "You are the only member."}

# Your duties
${member.role.duties.trim()}`;
  return kind === "task" ? `${who}\n\n${TASK_WAYS}` : who;
}

/** Work a subtask builds on, with what it delivered: what it depends on directly, or further up. */
export interface Upstream {
  subtask: Subtask;
  direct: boolean;
}

/**
 * The first message of a subtask's run: the goal, the task, the subtask,
 * where to work, what came from upstream, and what you want changed when its
 * task came back with no session to go on in.
 */
export function taskBrief(input: {
  goal: Goal;
  task: Task;
  subtask: Subtask;
  cwd: string;
  branch: string;
  upstream: readonly Upstream[];
  revision?: string;
}): string {
  const { goal, task, subtask } = input;
  const lines = [
    `Goal: ${goal.name}`,
    `Task: ${task.title}${task.outcome && task.outcome !== task.title ? `. ${task.outcome}` : ""}`,
    "",
    `Your subtask: ${subtask.title}`,
    ...(subtask.description && subtask.description !== subtask.title ? [subtask.description] : []),
    ...(subtask.acceptance ? ["", `Acceptance criteria: ${subtask.acceptance}`] : []),
    "",
    `Your worktree is ${input.cwd}, on branch ${input.branch}.`,
  ];
  const delivered = (s: Subtask) =>
    `- ${s.title}, by ${s.assignee}: ${s.delivery?.summary ?? ""}${s.delivery?.files.length ? ` Files: ${s.delivery.files.join(", ")}` : ""}`;
  const direct = input.upstream.filter((u) => u.direct).map((u) => delivered(u.subtask));
  const further = input.upstream.filter((u) => !u.direct).map((u) => delivered(u.subtask));
  if (direct.length)
    lines.push("", "It builds on this work, merged into the goal's branch:", ...direct);
  if (further.length) lines.push("", "Which built on:", ...further);
  if (input.revision)
    lines.push("", `The user sent this task back before, asking for:\n${input.revision}`);
  return lines.join("\n");
}

/**
 * The first message of a run that goes on in the session of the one before
 * (Subtask.goOn): each thing that came up since, once, in the order it came.
 */
export function goOnMessage(reasons: readonly GoOn[], subtask: Subtask): string {
  const said = ({ why, note = "" }: GoOn) => {
    switch (why) {
      case "held":
        return "Your work was paused and now goes on. Pick up where you left off.";
      case "carried":
        return `The user adds to your subtask:\n${note}`;
      case "continued":
        return "The user asks you to go on from where you stopped.";
      case "rejected":
        return `The review sent your delivery back. Fix what it says, then deliver again:\n${subtask.review?.notes ?? ""}`;
      case "conflict":
        return `Merging your delivery into the goal's branch left conflicts in ${subtask.conflict?.files.join(", ") ?? ""}. The merge is under way in your worktree, the conflict markers in those files. Resolve them, keeping what both sides meant, then deliver again.`;
      case "redo":
        return `Work you build on was redone after you delivered: ${note}. Your worktree now starts from the goal's branch as it stands. Check your part against it, change what needs changing, and deliver again.`;
      case "revised":
        return `The user sent your task back, asking for:\n${note}\nMake those changes, then deliver again.`;
    }
  };
  return [...new Set(reasons.map(said))].join("\n\n");
}

/** A run ended without delivering: it is reminded once, in the same session. */
export const DELIVER_REMINDER =
  "You haven't delivered yet. If the work is finished, call deliver now with a summary and the files that are the result. If you can't finish it, say what stands in the way.";

/** A subagent the member started may not speak for the subtask: asking and delivering are the session's own. */
export const SESSION_ONLY =
  "Only the session that started you asks teammates and delivers this subtask: do your own part and report back to it.";

/** What a reviewer is asked: the subtask, its acceptance criteria and what was delivered, checked in its worktree. */
export function reviewPrompt(input: {
  task: Task;
  subtask: Subtask;
  delivery: Delivery;
  cwd: string;
}): string {
  const { task, subtask, delivery } = input;
  const files = delivery.files.length
    ? delivery.files.join(", ")
    : "none (the summary is the result)";
  return `You're reviewing a teammate's delivery before it is merged into the goal's branch.

Task: ${task.title}
Subtask: ${subtask.title}
${subtask.description && subtask.description !== subtask.title ? `${subtask.description}\n` : ""}Acceptance criteria: ${subtask.acceptance || "none given: judge whether the subtask is done as described"}

${subtask.assignee} delivered:
${delivery.summary}
Files: ${files}

Their worktree is ${input.cwd}. Read the files, and whatever else you need there, to check the work against the criteria, and stop once you can tell. Pass it when it meets them, even if you would have done it differently; send it back only for what really falls short, and say exactly what to fix.`;
}

/** A teammate's question, with what the member asked has done on the goal. */
export function teammateQuestion(input: {
  from: Member;
  subtask: Subtask;
  question: string;
  /** The subtasks of the goal the member asked has. */
  own: readonly Subtask[];
}): string {
  const own = input.own.map(
    (s) => `- ${s.title} (${s.status})${s.delivery ? `: ${s.delivery.summary}` : ""}`,
  );
  return `Your teammate ${called(input.from)} asks you this while working on "${input.subtask.title}":
${input.question}

${own.length ? `Your own work on this goal:\n${own.join("\n")}` : "You have no work of your own on this goal yet."}

Look up only what the answer needs, then answer briefly from your role. Where you're unsure, make a suggestion and state your assumptions.`;
}

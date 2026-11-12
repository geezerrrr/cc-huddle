/**
 * The state machines (docs/design.md §4): each a table of events and the
 * states they move from and to. Each table is moved by one owner module only
 * (goals, meetings, the scheduler, questions) through `step`; a move the
 * table lacks is refused. What you can be offered is asked of the same table
 * with `can`, in derive.ts.
 */
import type { MeetingStatus, GoalStatus, QuestionStatus, SubtaskStatus } from "./types.ts";

/** Each event: the states it may happen in, and the state it leads to. */
type Machine<S extends string> = Record<string, { from: readonly S[]; to: S }>;

export const GOAL_MACHINE = {
  pause: { from: ["active"], to: "paused" },
  archive: { from: ["active", "paused"], to: "archived" },
  resume: { from: ["paused", "archived"], to: "active" },
} as const satisfies Machine<GoalStatus>;

export const MEETING_MACHINE = {
  plan: { from: ["running"], to: "review" },
  fail: { from: ["running"], to: "failed" },
  cancel: { from: ["running", "review"], to: "cancelled" },
  approve: { from: ["review"], to: "approved" },
  resume: { from: ["failed", "cancelled"], to: "running" },
} as const satisfies Machine<MeetingStatus>;

/**
 * A subtask's moves. Waiting on you in review or merging is a question to
 * you, not a move.
 */
export const SUBTASK_MACHINE = {
  /** The scheduler starts it: upstream merged, its assignee free, its goal active. */
  start: { from: ["pending"], to: "running" },
  /** Merging only while it waits on your call; a merge under way finishes first. */
  stop: { from: ["pending", "running", "reviewing", "merging"], to: "stopped" },
  /** Delivered with review on. */
  review: { from: ["running"], to: "reviewing" },
  /** Delivered with review off, or the review passed or was skipped. */
  merge: { from: ["running", "reviewing"], to: "merging" },
  fail: { from: ["running"], to: "failed" },
  /** Its goal paused, or you added to it: it goes on in its session. */
  hold: { from: ["running"], to: "pending" },
  /** The reviewer, or you, sent it back. */
  reject: { from: ["reviewing"], to: "pending" },
  merged: { from: ["merging"], to: "done" },
  /** Merging it left text conflicts for its assignee to resolve. */
  conflict: { from: ["merging"], to: "pending" },
  /** From the start: no session, delivery or worktree. */
  retry: { from: ["failed", "stopped"], to: "pending" },
  /** Where it stopped: its session and worktree. */
  continue: { from: ["failed", "stopped"], to: "pending" },
  /** Stopped after delivery (Subtask.stoppedIn): its review, or its merge, again. */
  reviewAgain: { from: ["stopped"], to: "reviewing" },
  mergeAgain: { from: ["stopped"], to: "merging" },
  /** Done, then redone in its session: its upstream changed, you added to it, or you sent its task back. */
  redo: { from: ["done"], to: "pending" },
} as const satisfies Machine<SubtaskStatus>;

export const QUESTION_MACHINE = {
  answer: { from: ["open"], to: "answered" },
  cancel: { from: ["open"], to: "cancelled" },
} as const satisfies Machine<QuestionStatus>;

/** The states a machine knows: every one it moves from or to. */
type StateOf<M extends Machine<string>> = M[keyof M]["from"][number] | M[keyof M]["to"];

/** Whether `event` may happen in `state`. */
export function can<M extends Machine<string>>(
  machine: M,
  state: StateOf<M>,
  event: keyof M,
): boolean {
  return machine[event]?.from.includes(state) ?? false;
}

/** The state `event` leads to from `state`; throws when the table has no such move. */
export function step<M extends Machine<string>>(
  machine: M,
  state: StateOf<M>,
  event: keyof M & string,
): M[keyof M]["to"] {
  const move = machine[event];
  if (!move?.from.includes(state)) throw new Error(`No "${event}" from "${state}"`);
  return move.to;
}

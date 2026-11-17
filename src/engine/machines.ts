/**
 * The state machines (docs/design.md §4): each a table of events and the
 * states they move from and to. Each table is moved by one owner module only
 * (goals, meetings, the scheduler) through `step`; a move the
 * table lacks is refused. What you can be offered is asked of the same table
 * with `can`, in derive.ts.
 */
import type { MeetingStatus, GoalStatus, SubtaskAction, SubtaskStatus } from "./types.ts";

/** Each event: the states it may happen in, and the state it leads to. */
type Machine<S extends string> = Record<string, { from: readonly S[]; to: S }>;

/** A deleted goal is removed from the state, not kept as `removed`. */
export const GOAL_MACHINE = {
  pause: { from: ["active"], to: "paused" },
  archive: { from: ["active", "paused"], to: "archived" },
  resume: { from: ["paused", "archived"], to: "active" },
  delete: { from: ["archived"], to: "removed" },
} as const satisfies Machine<GoalStatus | "removed">;

export const MEETING_MACHINE = {
  plan: { from: ["running"], to: "review" },
  fail: { from: ["running"], to: "failed" },
  /** Stopped before its plan, it can go on from there. */
  cancel: { from: ["running"], to: "cancelled" },
  /** Its plan dropped, it is over. */
  drop: { from: ["review"], to: "dropped" },
  change: { from: ["review"], to: "review" },
  approve: { from: ["review"], to: "approved" },
  resume: { from: ["failed", "cancelled"], to: "running" },
} as const satisfies Machine<MeetingStatus>;

/** A subtask's moves. */
export const SUBTASK_MACHINE = {
  /** The scheduler starts it: upstream merged, its assignee free, its goal active. */
  start: { from: ["pending"], to: "running" },
  stop: { from: ["pending", "running"], to: "stopped" },
  /** Stopped once handed over, its delivery stands, to go on from the stage it stopped in. */
  stopReview: { from: ["reviewing", "waitingInReview"], to: "stoppedInReview" },
  /** Only while it waits on your call; a merge under way finishes first. */
  stopMerge: { from: ["waitingInMerge"], to: "stoppedInMerge" },
  /** Delivered with review on. */
  review: { from: ["running"], to: "reviewing" },
  /** A review sent it back too often, or failed: it waits on your decision. */
  askReview: { from: ["reviewing"], to: "waitingInReview" },
  /** You had it reviewed again. */
  rereview: { from: ["waitingInReview"], to: "reviewing" },
  /** Delivered with review off, or the review passed or you skipped it. */
  merge: { from: ["running", "reviewing", "waitingInReview"], to: "merging" },
  fail: { from: ["running"], to: "failed" },
  /** Its goal paused, or you added to it: it goes on in its session. */
  hold: { from: ["running"], to: "pending" },
  /** The reviewer, or you, sent it back. */
  reject: { from: ["reviewing", "waitingInReview"], to: "pending" },
  merged: { from: ["merging"], to: "done" },
  /** Merging it left text conflicts for its assignee to resolve. */
  conflict: { from: ["merging"], to: "pending" },
  /** Files it can't merge line by line, or git failing: it waits on your decision. */
  askMerge: { from: ["merging"], to: "waitingInMerge" },
  /** You kept a side, or had it merged again. */
  remerge: { from: ["waitingInMerge"], to: "merging" },
  /** From the start: no session, delivery or worktree. */
  retry: { from: ["failed", "stopped", "stoppedInReview", "stoppedInMerge"], to: "pending" },
  /** Where it stopped: its session and worktree. */
  continue: { from: ["failed", "stopped"], to: "pending" },
  /** Stopped after delivery: its review, or its merge, again. */
  reviewAgain: { from: ["stoppedInReview"], to: "reviewing" },
  mergeAgain: { from: ["stoppedInMerge"], to: "merging" },
  /** Done, then done again in its session: you sent its task back. */
  redo: { from: ["done"], to: "pending" },
} as const satisfies Machine<SubtaskStatus>;

export type SubtaskEvent = keyof typeof SUBTASK_MACHINE;

/** The events each of your actions on a subtask is: it does the one that can happen. */
const ACTION_EVENTS: Record<SubtaskAction, readonly SubtaskEvent[]> = {
  stop: ["stop", "stopReview", "stopMerge"],
  continue: ["continue", "reviewAgain", "mergeAgain"],
  retry: ["retry"],
};

/** The event `action` is in `status`; undefined where it can't be done. */
export const actionEvent = (status: SubtaskStatus, action: SubtaskAction) =>
  ACTION_EVENTS[action].find((event) => can(SUBTASK_MACHINE, status, event));

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
export function step<M extends Machine<string>, E extends keyof M & string>(
  machine: M,
  state: StateOf<M>,
  event: E,
): M[E]["to"] {
  const move = machine[event];
  if (!move?.from.includes(state)) throw new Error(`No "${event}" from "${state}"`);
  return move.to;
}

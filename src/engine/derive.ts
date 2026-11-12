/**
 * What the rules make of the state (docs/design.md §4.5): what each subtask
 * waits on, who is busy, who reviews a delivery, whose upstream was redone,
 * and what you can do to each subtask and goal. Worked out here only and
 * never stored: the scheduler acts on it, and the plugin shows it.
 */
import { can, MEETING_MACHINE, GOAL_MACHINE, SUBTASK_MACHINE } from "./machines.ts";
import {
  GOAL_ACTIONS,
  isHalted,
  type Derived,
  type Meeting,
  type Goal,
  type GoalAction,
  type Subtask,
  type SubtaskAction,
  type TeamState,
  type Wait,
} from "./types.ts";

/** What the rules read: the state, and the team's members in their order. */
export interface Work extends TeamState {
  members: readonly string[];
}

const openQuestions = (state: Pick<TeamState, "questions">, subtaskId: string) =>
  state.questions.filter((q) => q.subtaskId === subtaskId && q.status === "open");

const isActive = (state: Pick<TeamState, "goals">, goalId: string) =>
  state.goals.find((p) => p.id === goalId)?.status === "active";

/**
 * Who reviews a subtask's delivery (§4.5): its meeting's host, else the first
 * other member, whichever isn't its assignee; with nobody else, its assignee.
 */
export function reviewerOf(
  state: Pick<Work, "tasks" | "meetings" | "members">,
  subtask: Subtask,
): string {
  const meetingId = state.tasks.find((t) => t.id === subtask.taskId)?.meetingId;
  const host = state.meetings.find((m) => m.id === meetingId)?.host;
  const other = state.members.find((m) => m !== subtask.assignee);
  return [host, other].find((m) => m !== undefined && m !== subtask.assignee) ?? subtask.assignee;
}

/** The acceptance a task waits for, its subtasks all done. */
function acceptanceOf(state: Pick<TeamState, "questions" | "subtasks">, taskId: string) {
  return state.questions.find(
    (q) =>
      q.status === "open" &&
      q.kind === "decision" &&
      q.decision.kind === "delivery" &&
      state.subtasks.find((s) => s.id === q.subtaskId)?.taskId === taskId,
  );
}

/** Whether a subtask in review is being reviewed now: its goal is active and you aren't deciding on it. */
const underReview = (state: Pick<TeamState, "goals" | "questions">, subtask: Subtask) =>
  subtask.status === "reviewing" &&
  isActive(state, subtask.goalId) &&
  !openQuestions(state, subtask.id).some((q) => q.kind === "decision");

/**
 * Who is busy, and so starts nothing new and can't join a meeting: whoever
 * has a subtask running, the assignee and reviewer of one under review, and
 * everyone in a running meeting.
 */
export function busyMembers(state: Work): Set<string> {
  const busy = new Set<string>();
  for (const s of state.subtasks) {
    if (s.status === "running") busy.add(s.assignee);
    if (underReview(state, s)) busy.add(s.assignee).add(reviewerOf(state, s));
  }
  for (const m of state.meetings)
    if (m.status === "running") for (const id of m.participants) busy.add(id);
  return busy;
}

/**
 * Whom a review that could go on waits for: its reviewer while they are at
 * something else (their own subtask, a meeting, a review of work delivered
 * earlier), as everyone does one thing at a time.
 */
function reviewerAway(state: Work, subtask: Subtask): string | undefined {
  const reviewer = reviewerOf(state, subtask);
  const at = subtask.delivery?.at ?? 0;
  const index = state.subtasks.indexOf(subtask);
  const working = state.subtasks.some((s) => s.status === "running" && s.assignee === reviewer);
  const meeting = state.meetings.some(
    (m) => m.status === "running" && m.participants.includes(reviewer),
  );
  const earlier = state.subtasks.some((s, i) => {
    if (s === subtask || !underReview(state, s) || reviewerOf(state, s) !== reviewer) return false;
    const sAt = s.delivery?.at ?? 0;
    return sAt < at || (sAt === at && i < index);
  });
  return working || meeting || earlier ? reviewer : undefined;
}

/** What a subtask waits on in its stage; `busy` is busyMembers. */
export function waitsIn(state: Work, subtask: Subtask, busy: Set<string>): Wait[] {
  const goal = state.goals.find((p) => p.id === subtask.goalId);
  const held: Wait[] =
    goal && goal.status !== "active" ? [{ kind: "goal", status: goal.status }] : [];
  const asked = (): Wait[] =>
    openQuestions(state, subtask.id).map((q) =>
      q.kind === "teammate"
        ? { kind: "teammate", by: q.to, questionId: q.id }
        : q.kind === "decision"
          ? { kind: "you", questionId: q.id, decision: q.decision.kind }
          : { kind: "you", questionId: q.id },
    );
  switch (subtask.status) {
    case "pending": {
      if (held.length) return held;
      const unmerged = (d: Subtask): Wait => ({
        kind: "upstream",
        by: d.assignee,
        subtaskId: d.id,
        halted: isHalted(d.status),
      });
      const upstream = subtask.dependsOn.flatMap((id): Wait[] => {
        const d = state.subtasks.find((s) => s.id === id);
        if (!d) return [];
        if (d.status !== "done") return [unmerged(d)];
        if (d.taskId === subtask.taskId) return [];
        // Done in another task: that whole task is yours to accept first, so
        // the rest of it is waited for, then your acceptance.
        const rest = state.subtasks.find((s) => s.taskId === d.taskId && s.status !== "done");
        if (rest) return [unmerged(rest)];
        const acceptance = acceptanceOf(state, d.taskId);
        return acceptance ? [{ kind: "acceptance", questionId: acceptance.id }] : [];
      });
      // Several upstreams in one other task wait on the same thing: once each.
      if (upstream.length)
        return [...new Map(upstream.map((w) => [JSON.stringify(w), w])).values()];
      return busy.has(subtask.assignee) ? [{ kind: "busy", by: subtask.assignee }] : [];
    }
    // A done subtask, the last of its task, carries the task's acceptance waiting on you.
    case "running":
    case "done":
      return asked();
    // A merge under way finishes (§3.2); one yet to start waits for its goal.
    case "merging":
      return [...held, ...asked()];
    case "reviewing": {
      const reviewer = underReview(state, subtask) ? reviewerAway(state, subtask) : undefined;
      return [...held, ...asked(), ...(reviewer ? [{ kind: "busy" as const, by: reviewer }] : [])];
    }
    case "failed":
    case "stopped":
      return [];
  }
}

/** The upstream subtasks a done subtask built on that were done again after it started. */
export function redoneUpstream(state: Pick<TeamState, "subtasks">, subtask: Subtask): Subtask[] {
  const startedAt = subtask.startedAt;
  if (subtask.status !== "done" || startedAt === undefined) return [];
  return subtask.dependsOn.flatMap((id) => {
    const d = state.subtasks.find((s) => s.id === id);
    return d?.status === "done" && (d.finishedAt ?? 0) > startedAt ? [d] : [];
  });
}

/**
 * What you can do to a subtask where it stands: redo it only once its
 * upstream was redone; stop a merge only while it waits on your call.
 */
function subtaskActions(subtask: Subtask, redone: boolean, deciding: boolean): SubtaskAction[] {
  const moves = (["stop", "continue", "retry"] as const).filter(
    (event) =>
      can(SUBTASK_MACHINE, subtask.status, event) &&
      (event !== "stop" || subtask.status !== "merging" || deciding),
  );
  return redone && can(SUBTASK_MACHINE, subtask.status, "redo") ? [...moves, "redo"] : moves;
}

/** What can be done to a goal where it stands. */
function goalActions(goal: Goal): GoalAction[] {
  return GOAL_ACTIONS.filter((event) => can(GOAL_MACHINE, goal.status, event));
}

/**
 * Whether a meeting can go on from where it stopped: it stopped before its
 * plan was out, its goal is active, and everyone at it is still on the
 * team. Who is busy changes by the minute; it is asked as the meeting starts.
 */
export function meetingResumes(state: Work, meeting: Meeting): boolean {
  return (
    can(MEETING_MACHINE, meeting.status, "resume") &&
    !meeting.plan &&
    isActive(state, meeting.goalId) &&
    meeting.participants.every((m) => state.members.includes(m))
  );
}

/** Everything the plugin shows of the rules, worked out once. */
export function derive(state: Work): Derived {
  const busy = busyMembers(state);
  return {
    subtasks: Object.fromEntries(
      state.subtasks.map((s) => {
        const redone = redoneUpstream(state, s).map((d) => d.id);
        const actions = subtaskActions(s, redone.length > 0, openQuestions(state, s.id).length > 0);
        return [s.id, { waits: waitsIn(state, s, busy), actions, redone }];
      }),
    ),
    goals: Object.fromEntries(state.goals.map((p) => [p.id, goalActions(p)])),
    busy: [...busy],
    resumable: state.meetings.filter((m) => meetingResumes(state, m)).map((m) => m.id),
  };
}

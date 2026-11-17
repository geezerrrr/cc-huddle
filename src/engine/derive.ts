/**
 * What the rules make of the state (docs/design.md §4.5): what each subtask
 * waits on, who is busy, who reviews a delivery, and which tasks are
 * accepted. Worked out here only and never stored: the scheduler acts on it,
 * and the plugin shows it.
 */
import { can, MEETING_MACHINE } from "./machines.ts";
import {
  hostOf,
  isAcceptance,
  isHalted,
  type Derived,
  type Meeting,
  type MeetingNow,
  type Question,
  type Subtask,
  type GoalState,
  type Wait,
} from "./types.ts";

/**
 * What the rules read: the state, the team's members in their order, and
 * what is under way, which the state doesn't keep (after a restart none is):
 * the subtasks whose review or merge is, what goes on at each running
 * meeting, by its id, and what members' turns wait on.
 */
export interface Work extends Omit<GoalState, "questions"> {
  /** Your decisions, and what members' turns wait on now. */
  questions: readonly Question[];
  members: readonly string[];
  underWay: readonly string[];
  meetingsNow: Readonly<Record<string, MeetingNow>>;
  /** The goal's worktree: its branch checked out, where its work can be tried. */
  checkout: string;
  /** The goal handing its work back now (§4.1): `by`, the member resolving its conflicts, while one is. */
  handingBack?: { by?: string };
}

const openQuestions = (state: Pick<Work, "questions">, subtaskId: string | undefined) =>
  state.questions.filter((q) => q.subtaskId === subtaskId);

const isActive = (state: Pick<GoalState, "goal">) => state.goal.status === "active";

/** In progress: worked on, in review or being merged, or waiting on you there. */
const IN_PROGRESS: readonly Subtask["status"][] = [
  "running",
  "reviewing",
  "waitingInReview",
  "merging",
  "waitingInMerge",
];

export const inProgress = (subtask: Subtask) => IN_PROGRESS.includes(subtask.status);

/** Whether a task done may be sent back by way of `sentBack`: one of its subtasks that is done, or none named. */
export function canSendBack(
  state: Pick<GoalState, "subtasks">,
  question: Question,
  sentBack: string | undefined,
): boolean {
  if (sentBack === undefined) return true;
  const taskId = state.subtasks.find((s) => s.id === question.subtaskId)?.taskId;
  const target = state.subtasks.find((s) => s.id === sentBack);
  return target !== undefined && target.taskId === taskId && target.status === "done";
}

/** Whether a task is done: every subtask of it merged, whether or not you accept it yet (§7.1). */
export const taskDone = (state: Pick<GoalState, "subtasks">, taskId: string) =>
  state.subtasks.every((s) => s.taskId !== taskId || s.status === "done");

/**
 * Who reviews a subtask's delivery (§4.5): its meeting's host, else the first
 * other member, whichever isn't its assignee; with nobody else, its assignee.
 */
export function reviewerOf(
  state: Pick<Work, "tasks" | "meetings" | "members">,
  subtask: Subtask,
): string {
  const meetingId = state.tasks.find((t) => t.id === subtask.taskId)?.meetingId;
  const meeting = state.meetings.find((m) => m.id === meetingId);
  const host = meeting && hostOf(meeting);
  const other = state.members.find((m) => m !== subtask.assignee);
  return [host, other].find((m) => m !== undefined && m !== subtask.assignee) ?? subtask.assignee;
}

/** The acceptance a task waits for, its subtasks all done. */
export function acceptanceOf(state: Pick<Work, "questions" | "subtasks">, taskId: string) {
  return state.questions.find(
    (q) => isAcceptance(q) && state.subtasks.find((s) => s.id === q.subtaskId)?.taskId === taskId,
  );
}

/** Whether a task you accept is accepted: done, with no acceptance waiting on you (§7.1). */
export const accepted = (state: Pick<Work, "questions" | "subtasks">, taskId: string) =>
  taskDone(state, taskId) && !acceptanceOf(state, taskId);

/** Whether the goal has had its one planning (§2): a meeting called, or work assigned. */
export const planned = (state: Pick<GoalState, "meetings" | "subtasks">) =>
  state.meetings.length > 0 || state.subtasks.length > 0;

/** Whether the goal's work is all done (§4.1): it has tasks, and every one is done, whether or not you accept it yet. */
export const workDone = (state: Pick<GoalState, "tasks" | "subtasks">) =>
  state.tasks.length > 0 && state.tasks.every((t) => taskDone(state, t.id));

/** The acceptance that is all the goal still waits on, if one is: its work done, and no other acceptance open. */
export function lastAcceptance(state: Pick<Work, "tasks" | "subtasks" | "questions">) {
  const open = state.questions.filter(isAcceptance);
  return workDone(state) && open.length === 1 ? open[0] : undefined;
}

/**
 * Whether nothing in the goal's plan can go on (§4.1): no meeting that can,
 * and every task done and accepted, or, with no tasks, its plan dropped.
 */
export function over(state: Pick<Work, "meetings" | "tasks" | "subtasks" | "questions">): boolean {
  if (state.meetings.some((m) => m.status !== "approved" && m.status !== "dropped")) return false;
  if (!state.tasks.length) return state.meetings.some((m) => m.status === "dropped");
  return state.tasks.every((t) => accepted(state, t.id));
}

/** Whether a subtask handed over is taken up in `stage`: it is there and its goal is active. */
const takenUpIn = (
  state: Pick<GoalState, "goal">,
  subtask: Subtask,
  stage: "reviewing" | "merging",
) => subtask.status === stage && isActive(state);

/**
 * Who is busy, and so starts nothing new and can't join a meeting: whoever
 * has a subtask running, the assignee and reviewer of one under review, and
 * everyone in a running meeting.
 */
export function busyMembers(state: Work): Set<string> {
  const busy = new Set<string>();
  for (const s of state.subtasks) {
    if (s.status === "running") busy.add(s.assignee);
    if (takenUpIn(state, s, "reviewing")) busy.add(s.assignee).add(reviewerOf(state, s));
  }
  for (const m of state.meetings)
    if (m.status === "running") for (const id of m.participants) busy.add(id);
  return busy;
}

/**
 * Of the subtasks handed over and waiting like `subtask` (`alike`), one that
 * goes before it: one under way, else one delivered earlier (the earlier in
 * the list on a tie). Reviews by one reviewer, and merges, go so, one at a time.
 */
function ahead(state: Work, subtask: Subtask, alike: (s: Subtask) => boolean): Subtask | undefined {
  const at = subtask.delivery?.at ?? 0;
  const index = state.subtasks.indexOf(subtask);
  const others = state.subtasks.filter((s) => s !== subtask && alike(s));
  return (
    others.find((s) => state.underWay.includes(s.id)) ??
    others.find((s) => {
      const sAt = s.delivery?.at ?? 0;
      return sAt < at || (sAt === at && state.subtasks.indexOf(s) < index);
    })
  );
}

/**
 * Whom a review that could go on waits for: with `parallel` off, its
 * reviewer while they are at something else (their own subtask, a meeting,
 * a review under way or of work delivered earlier), as everyone does one
 * thing at a time; with it on, nobody (§4.5).
 */
function reviewerAway(state: Work, subtask: Subtask): string | undefined {
  if (state.goal.settings.parallel) return undefined;
  const reviewer = reviewerOf(state, subtask);
  const working = state.subtasks.some((s) => s.status === "running" && s.assignee === reviewer);
  const meeting = state.meetings.some(
    (m) => m.status === "running" && m.participants.includes(reviewer),
  );
  const reviewing = ahead(
    state,
    subtask,
    (s) => takenUpIn(state, s, "reviewing") && reviewerOf(state, s) === reviewer,
  );
  return working || meeting || reviewing ? reviewer : undefined;
}

/**
 * What a pending subtask waits on before it could start, its member's other
 * work aside: its goal, its upstream, and, with `parallel` off, its member
 * while busy.
 */
function startWaits(state: Work, subtask: Subtask, busy: Set<string>): Wait[] {
  const { goal } = state;
  if (goal.status !== "active") return [{ kind: "goal", status: goal.status }];
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
    // Done in another task you accept: that whole task is yours to accept
    // first, so the rest of it is waited for, then your acceptance.
    if (!state.tasks.find((t) => t.id === d.taskId)?.ownerAccepts || accepted(state, d.taskId))
      return [];
    const rest = state.subtasks.find((s) => s.taskId === d.taskId && s.status !== "done");
    if (rest) return [unmerged(rest)];
    const acceptance = acceptanceOf(state, d.taskId);
    return acceptance ? [{ kind: "acceptance", questionId: acceptance.id }] : [];
  });
  // Several upstreams in one other task wait on the same thing: once each.
  if (upstream.length) return [...new Map(upstream.map((w) => [JSON.stringify(w), w])).values()];
  return busy.has(subtask.assignee) && !goal.settings.parallel
    ? [{ kind: "busy", by: subtask.assignee }]
    : [];
}

/** What a subtask waits on in its stage; `busy` is busyMembers. */
export function waitsIn(state: Work, subtask: Subtask, busy: Set<string>): Wait[] {
  const { goal } = state;
  const held: Wait[] = goal.status !== "active" ? [{ kind: "goal", status: goal.status }] : [];
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
      const waits = startWaits(state, subtask, busy);
      if (waits.length || goal.settings.parallel) return waits;
      // A member starts one thing at a time: of theirs that could start, one
      // going on in its session first, else the first in the list.
      const could = state.subtasks.filter(
        (s) =>
          s.status === "pending" &&
          s.assignee === subtask.assignee &&
          !startWaits(state, s, busy).length,
      );
      const first = could.find((s) => s.session !== undefined) ?? could[0];
      return first && first !== subtask ? [{ kind: "after", subtaskId: first.id }] : [];
    }
    // A done subtask, the last of its task, carries the task's acceptance waiting on you.
    case "running":
    case "done":
      return asked();
    // A merge under way finishes (§3.2); one yet to start waits for its goal, and its turn.
    case "merging": {
      if (state.underWay.includes(subtask.id)) return asked();
      const before = takenUpIn(state, subtask, "merging")
        ? ahead(state, subtask, (s) => takenUpIn(state, s, "merging"))
        : undefined;
      return [
        ...held,
        ...asked(),
        ...(before ? [{ kind: "merge" as const, subtaskId: before.id }] : []),
      ];
    }
    case "reviewing": {
      if (state.underWay.includes(subtask.id)) return asked();
      const reviewer = takenUpIn(state, subtask, "reviewing")
        ? reviewerAway(state, subtask)
        : undefined;
      return [...held, ...asked(), ...(reviewer ? [{ kind: "busy" as const, by: reviewer }] : [])];
    }
    case "waitingInReview":
    case "waitingInMerge":
      return [...held, ...asked()];
    case "failed":
    case "stopped":
    case "stoppedInReview":
    case "stoppedInMerge":
      return [];
  }
}

/** Work a subtask builds on, with what it delivered: what it depends on directly, or further up. */
export interface Upstream {
  subtask: Subtask;
  direct: boolean;
}

/** The work a subtask builds on, up the chain of dependencies: what it depends on directly first. */
export function upstreamOf(state: Pick<GoalState, "subtasks">, subtask: Subtask): Upstream[] {
  const chain: Upstream[] = [];
  const seen = new Set([subtask.id]);
  let level = subtask.dependsOn;
  for (let direct = true; level.length; direct = false) {
    const next: string[] = [];
    for (const id of level) {
      const done = state.subtasks.find((s) => s.id === id);
      if (!done || seen.has(id)) continue;
      seen.add(id);
      chain.push({ subtask: done, direct });
      next.push(...done.dependsOn);
    }
    level = next;
  }
  return chain;
}

/**
 * The subtask whose session a subtask's first run forks (§4.3): of those it
 * depends on directly, one of its member's own, merged, the one merged last.
 * None: its first run is a session of its own.
 */
export function forkOf(state: Pick<GoalState, "subtasks">, subtask: Subtask): Subtask | undefined {
  return state.subtasks
    .filter(
      (s) =>
        subtask.dependsOn.includes(s.id) &&
        s.assignee === subtask.assignee &&
        s.status === "done" &&
        s.session !== undefined,
    )
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0];
}

/**
 * Whether a meeting can go on from where it stopped: it stopped before its
 * plan, and its goal is active. Who is busy changes by the minute; it is
 * asked as the meeting starts.
 */
export function meetingResumes(state: Work, meeting: Meeting): boolean {
  return can(MEETING_MACHINE, meeting.status, "resume") && isActive(state);
}

/** Everything the plugin shows of the rules, worked out once. */
export function derive(state: Work): Derived {
  const busy = busyMembers(state);
  return {
    subtasks: Object.fromEntries(
      state.subtasks.map((s) => {
        const reviewed = s.status === "reviewing" && state.underWay.includes(s.id);
        return [
          s.id,
          {
            waits: waitsIn(state, s, busy),
            ...(reviewed && { reviewedBy: reviewerOf(state, s) }),
          },
        ];
      }),
    ),
    busy: [...busy],
    resumable: state.meetings.filter((m) => meetingResumes(state, m)).map((m) => m.id),
  };
}

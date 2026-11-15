/**
 * The team's state as the engine keeps it (docs/design.md §2, §4). Members
 * are named by their file in the team folder; everything here refers to them
 * by that name. What anything waits on is never stored: derive.ts works it
 * out from this.
 */
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";

/** A job and its duties, from its file in the team folder (§6). */
export interface Role {
  /** The file's name. */
  id: string;
  title: string;
  /** The file's Markdown. */
  duties: string;
}

/** Someone on the team, from their file in the team folder (§6). */
export interface Member {
  /** The file's name. */
  name: string;
  role: Role;
  model?: string;
  effort?: EffortLevel;
  /** Their Claude Code's environment, `${VAR}` not filled in yet. */
  env: Record<string, string>;
}

export type GoalStatus = "active" | "paused" | "archived";

/** One goal, on a branch of its own cut from your HEAD when it started (§5). */
export interface Goal {
  name: string;
  /** Its name in git: its branches are under `openplan/<slug>/` (git.ts). */
  slug: string;
  status: GoalStatus;
  /** When it started: the repository's goals are listed in that order. */
  createdAt: number;
}

/** One result for you: a group of subtasks, done once they all are. */
export interface Task {
  id: string;
  title: string;
  /** What it delivers. */
  outcome: string;
  /** The meeting whose approved plan it came from; none when assigned directly. */
  meetingId?: string;
  /**
   * Done, it waits for you to accept it, and work in other tasks that builds
   * on it waits for that; else it is done as its last subtask merges (§7.1).
   */
  ownerAccepts: boolean;
}

export type SubtaskStatus =
  | "pending"
  | "running"
  | "reviewing"
  | "waitingInReview"
  | "merging"
  | "waitingInMerge"
  | "done"
  | "failed"
  | "stopped"
  | "stoppedInReview"
  | "stoppedInMerge";

/** Failed or stopped: it waits for you to go on or retry. */
export const isHalted = (status: SubtaskStatus) =>
  status === "failed" ||
  status === "stopped" ||
  status === "stoppedInReview" ||
  status === "stoppedInMerge";

/** What a run hands over: what was done, and the files that are the result (relative to its worktree). */
export interface Handover {
  summary: string;
  files: string[];
}

/** A subtask's handover, and when it came. */
export type Delivery = Handover & { at: number };

/**
 * Why a subtask's next run goes on in its last session instead of starting
 * over: held (its goal paused), you added to it, you went
 * on, the review sent it back, a merge left conflicts, its upstream was
 * redone, or you sent its task back with what to change.
 */
type GoOnReason = "held" | "carried" | "continued" | "rejected" | "conflict" | "redo" | "revised";

/** One reason a subtask goes on in its session, with what it carries (the notes, the files, your words). */
export interface GoOn {
  why: GoOnReason;
  note?: string;
}

export interface Progress {
  done: number;
  total: number;
  /** The step the member is on now. */
  current?: string;
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  description: string;
  acceptance: string;
  assignee: string;
  dependsOn: string[];
  status: SubtaskStatus;
  startedAt?: number;
  finishedAt?: number;
  progress: Progress;
  delivery?: Delivery;
  /** The reviewer's last word: how many times it was sent back, and why. */
  review?: { rounds: number; notes?: string };
  /** Merging it left these text files in conflict, for its assignee to resolve. */
  conflict?: { files: string[] };
  error?: string;
  /** The session its last run was in. */
  session?: string;
  /** Every reason its next run goes on in `session`, in the order they came. */
  goOn?: GoOn[];
}

/** One subtask in a plan (keys are local to the plan). */
export interface PlanSubtask {
  key: string;
  title: string;
  description: string;
  assignee: string;
  dependsOn: string[];
  acceptance: string;
}

export interface PlanTask {
  title: string;
  outcome: string;
  /** Whether you accept it once done (Task.ownerAccepts): off unless you tick it in review. */
  ownerAccepts: boolean;
  subtasks: PlanSubtask[];
}

/** What a meeting hands you for review. */
export interface Plan {
  summary: string;
  markdown: string;
  tasks: PlanTask[];
}

export const MEETING_SIZES = ["small", "discussion", "large"] as const;
export type MeetingSize = (typeof MEETING_SIZES)[number];

export type MeetingStatus = "running" | "review" | "approved" | "cancelled" | "dropped" | "failed";

export interface MeetingTurn {
  speaker: string;
  text: string;
  at: number;
  /** Which part of the meeting it belongs to: how far the meeting got is read off these. */
  phase: "opening" | "round" | "steer" | "answer" | "summary";
  /** Whom the host gave the floor to (a steer turn). */
  calls?: string;
}

/** A raised hand: what they would say, and to whom. */
export interface MeetingHand {
  member: string;
  point: string;
  to?: string;
}

/** A member's session for a whole meeting, and how many turns of it they have heard. */
interface MeetingSeat {
  session: string;
  heard: number;
}

export interface Meeting {
  id: string;
  /** What the meeting is to plan. */
  agenda: string;
  size: MeetingSize;
  /** Everyone at it, the host first. */
  participants: [string, ...string[]];
  /**
   * The host only runs it: not one of its members, so no first judgment of
   * their own and no work in the plan (§4.2). Else they host and take part.
   */
  hostOnly?: boolean;
  status: MeetingStatus;
  turns: MeetingTurn[];
  seats?: Record<string, MeetingSeat>;
  plan?: Plan;
  error?: string;
}

/**
 * What is under way at a running meeting (§4.2), which its owner keeps and
 * the state doesn't: after a restart none is.
 */
export interface MeetingNow {
  /** Who speaks now, and whether it is the plan they write. */
  speaking?: { member: string; planning: boolean };
  /** Everyone at once: forming their first judgments, or deciding whether to speak next. */
  together?: "drafting" | "weighing";
  /** The hands up, from when who speaks next is weighed until the floor is given. */
  hands: MeetingHand[];
}

/** Who hosts a meeting: the first at it. */
export const hostOf = (meeting: Pick<Meeting, "participants">) => meeting.participants[0];

/** One multiple-choice question, as Claude Code's AskUserQuestion puts it. */
export interface Choice {
  question: string;
  header: string;
  options: { label: string; description: string; preview?: string }[];
  multiSelect: boolean;
}

/** What you can decide on a stuck review, a merge that needs you, or a finished task. */
export const DECISION_OPTIONS = [
  "rereview",
  "skip",
  "sendBack",
  "ours",
  "theirs",
  "retry",
  "stop",
  "accept",
  "revise",
] as const;
export type DecisionOption = (typeof DECISION_OPTIONS)[number];

/**
 * A decision on a subtask: what it offers, and the option a note typed
 * instead of a pick goes with, `needed` where that option is no answer
 * without one. A review stuck or failed, a merge with files it can't merge
 * line by line (`conflict`, its `files`) or one git failed, a task done.
 */
export type Decision =
  DecisionOf<"review" | "merge" | "delivery"> | (DecisionOf<"conflict"> & { files: string[] });

interface DecisionOf<K extends string> {
  kind: K;
  options: DecisionOption[];
  note?: { option: Extract<NoteOption, DecisionOption>; needed?: true };
}

/** The decisions there are, each as it is put to you. */
export const DECISIONS = {
  /** A review that sent the delivery back too often: send it back with its notes, and your words if you add some. */
  stuckReview: (): Decision => ({
    kind: "review",
    options: ["rereview", "skip", "sendBack"],
    note: { option: "sendBack" },
  }),
  /** A review that failed: with no notes of its own, it goes back only with your words. */
  failedReview: (): Decision => ({
    kind: "review",
    options: ["rereview", "skip", "sendBack"],
    note: { option: "sendBack", needed: true },
  }),
  /** Files a merge can't take line by line: keep one side, or merge again. */
  mergeFiles: (files: string[]): Decision => ({
    kind: "conflict",
    options: ["ours", "theirs", "retry"],
    files,
  }),
  /** A merge git failed on: try again, or stop the subtask, its delivery standing. */
  failedMerge: (): Decision => ({ kind: "merge", options: ["retry", "stop"] }),
  /** A task done that you accept: accept it, or send it back saying what to change. */
  delivery: (): Decision => ({
    kind: "delivery",
    options: ["accept", "revise"],
    note: { option: "revise", needed: true },
  }),
};

/** Whether picking `option` is no answer to `decision` without a note. */
export const noteNeeded = (decision: Decision, option: DecisionOption) =>
  decision.note?.option === option && decision.note.needed === true;

/** The answers a permission request offers; a note typed instead denies it, saying why. */
export const PERMISSION_OPTIONS = ["once", "always", "deny"] as const;
export type PermissionOption = (typeof PERMISSION_OPTIONS)[number];
export const PERMISSION_NOTE = "deny" satisfies PermissionOption;

/** The answers a note typed instead of a pick goes with: denying a permission, sending work back. */
export type NoteOption = typeof PERMISSION_NOTE | "sendBack" | "revise";

/**
 * A tool call waiting to be allowed: the tool, and its input as the member
 * gave it.
 */
export interface Permission {
  tool: string;
  input: Record<string, unknown>;
  options: PermissionOption[];
}

/**
 * Something a member waits on, or a decision that waits on you (§4.4): a
 * teammate's answer, or, put to you, your picks among choices, your leave for
 * a tool call, or a call the scheduler acts on, with no run waiting on it.
 * It is open until answered or called off. What a turn waits on ends with
 * the turn, so only decisions are in the state.
 */
export type Question = {
  id: string;
  /** The subtask it is about: whose run asks, or that you decide on. */
  subtaskId: string;
  /** Who asks. */
  from: string;
  text: string;
} & Ask;

/** What a question asks for. */
export type Ask =
  | { kind: "teammate"; to: string }
  | { kind: "choices"; choices: Choice[] }
  | { kind: "permission"; permission: Permission }
  /** On a subtask stuck in review or a merge, or the last one done of a task. */
  | { kind: "decision"; decision: Decision };

/** A decision put to you, the one kind of question the state keeps. */
export type DecisionQuestion = Extract<Question, { kind: "decision" }>;

/** A question put to you: every kind but a teammate's. */
export type QuestionToYou = Exclude<Question, { kind: "teammate" }>;

export const toYou = (question: Question): question is QuestionToYou =>
  question.kind !== "teammate";

/** A task done, waiting for you to accept it: the decision on its last subtask. */
export const isAcceptance = (question: Question) =>
  question.kind === "decision" && question.decision.kind === "delivery";

/** The state the engine saves for a goal: the goal, and its work. */
export interface GoalState {
  goal: Goal;
  tasks: Task[];
  subtasks: Subtask[];
  meetings: Meeting[];
  /** Your decisions open: what turns wait on is Questions.now. */
  questions: DecisionQuestion[];
  /** The tokens each member's sessions have used, by name: their runs, reviews, answers to teammates and meeting turns. */
  tokens: Record<string, number>;
}

/** What a subtask waits on now (§4.5). `halted`: the upstream failed or was stopped. */
export type Wait =
  | { kind: "goal"; status: "paused" | "archived" }
  | { kind: "upstream"; by: string; subtaskId: string; halted: boolean }
  | { kind: "busy"; by: string }
  /** Its member starts another of theirs first: one going on in its session, else the earlier. */
  | { kind: "after"; subtaskId: string }
  /** Merges go one at a time: one under way, or delivered before it. */
  | { kind: "merge"; subtaskId: string }
  | { kind: "teammate"; by: string; questionId: string }
  | { kind: "you"; questionId: string; decision?: Decision["kind"] }
  /** Upstream work in another task you accept, done, whose task waits for your acceptance. */
  | { kind: "acceptance"; questionId: string };

export const SUBTASK_ACTIONS = ["stop", "continue", "retry", "redo"] as const;
export type SubtaskAction = (typeof SUBTASK_ACTIONS)[number];

export const GOAL_ACTIONS = ["pause", "resume", "archive", "delete"] as const;

/** The rules applied to the state, worked out once for whoever shows it. */
export interface Derived {
  subtasks: Record<
    string,
    {
      waits: Wait[];
      /** The upstream subtasks done again since it started: it is built on work redone (§7.1). */
      redone: string[];
      /** Who reviews it, while its review is under way. */
      reviewedBy?: string;
    }
  >;
  busy: string[];
  /** Meetings that stopped before their plan and can go on from there. */
  resumable: string[];
}

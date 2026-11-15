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
  "pending" | "running" | "reviewing" | "merging" | "done" | "failed" | "stopped";

/** Failed or stopped: it waits for you to go on or retry. */
export const isHalted = (status: SubtaskStatus) => status === "failed" || status === "stopped";

/** What a subtask hands over: what was done, and the files that are the result (relative to its worktree). */
export interface Delivery {
  summary: string;
  files: string[];
  at: number;
}

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
  /** Stopped after it was handed over: the stage going on takes up again, its delivery standing. */
  stoppedIn?: "reviewing" | "merging";
  /** Tokens its runs, reviews and questions to teammates have used. */
  tokens: number;
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

export type MeetingStatus = "running" | "review" | "approved" | "cancelled" | "failed";

export interface MeetingTurn {
  speaker: string;
  text: string;
  at: number;
  /** Which part of the meeting it belongs to: how far the meeting got is read off these. */
  phase: "opening" | "round" | "steer" | "answer" | "summary";
  tokens: number;
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
  participants: string[];
  host: string;
  /**
   * The host only runs it: not one of its members, so no first judgment of
   * their own and no work in the plan (§4.2). Else they host and take part.
   */
  hostOnly?: boolean;
  status: MeetingStatus;
  turns: MeetingTurn[];
  /** Who is speaking now. */
  speaking?: string;
  /** The host is writing the plan. */
  planning?: boolean;
  /** The members are each forming their first judgment, all at once. */
  drafting?: boolean;
  /** The participants are deciding whether to speak next. */
  weighing?: boolean;
  hands?: MeetingHand[];
  seats?: Record<string, MeetingSeat>;
  plan?: Plan;
  tokens: number;
  error?: string;
}

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
  "accept",
  "revise",
] as const;
export type DecisionOption = (typeof DECISION_OPTIONS)[number];

type DecisionKind = "review" | "merge" | "delivery";

/**
 * What a decision of each kind offers, and the option a note typed instead
 * of a pick goes with, `needed` where that option is no answer without one.
 * A merge that failed for another reason than its files offers `retry` alone.
 */
export const DECISIONS: Record<
  DecisionKind,
  { options: readonly DecisionOption[]; note?: { option: DecisionOption; needed?: true } }
> = {
  review: { options: ["rereview", "skip", "sendBack"], note: { option: "sendBack" } },
  merge: { options: ["ours", "theirs", "retry"] },
  delivery: { options: ["accept", "revise"], note: { option: "revise", needed: true } },
};

/** Whether picking `option` is no answer to a decision of `kind` without a note. */
export function noteNeeded(kind: DecisionKind, option: DecisionOption): boolean {
  const { note } = DECISIONS[kind];
  return note?.option === option && note.needed === true;
}

/** The answers a permission request offers; a note typed instead denies it, saying why. */
export const PERMISSION_OPTIONS = ["once", "always", "deny"] as const;
export type PermissionOption = (typeof PERMISSION_OPTIONS)[number];
export const PERMISSION_NOTE: PermissionOption = "deny";

/** A decision on a subtask. `files`: conflicts that can't be merged line by line. */
export interface Decision {
  kind: DecisionKind;
  options: DecisionOption[];
  files?: string[];
}

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
 * It is in the state while it is open; answered or called off, it leaves.
 */
export type Question = {
  id: string;
  subtaskId?: string;
  /** Who asks. */
  from: string;
  text: string;
} & Ask;

/** What a question asks for. */
export type Ask =
  | { kind: "teammate"; to: string }
  | { kind: "choices"; choices: Choice[] }
  | { kind: "permission"; permission: Permission }
  | { kind: "decision"; decision: Decision };

/** A question put to you: every kind but a teammate's. */
export type QuestionToYou = Exclude<Question, { kind: "teammate" }>;

export const toYou = (question: Question): question is QuestionToYou =>
  question.kind !== "teammate";

/** The state the engine saves for a goal: the goal, and its work. */
export interface GoalState {
  goal: Goal;
  tasks: Task[];
  subtasks: Subtask[];
  meetings: Meeting[];
  questions: Question[];
}

/** What a subtask waits on now (§4.5). `halted`: the upstream failed or was stopped. */
export type Wait =
  | { kind: "goal"; status: "paused" | "archived" }
  | { kind: "upstream"; by: string; subtaskId: string; halted: boolean }
  | { kind: "busy"; by: string }
  /** Merges go one at a time: one under way, or delivered before it. */
  | { kind: "merge"; subtaskId: string }
  | { kind: "teammate"; by: string; questionId: string }
  | { kind: "you"; questionId: string; decision?: DecisionKind }
  /** Upstream work in another task you accept, done, whose task waits for your acceptance. */
  | { kind: "acceptance"; questionId: string };

export const SUBTASK_ACTIONS = ["stop", "continue", "retry", "redo"] as const;
export type SubtaskAction = (typeof SUBTASK_ACTIONS)[number];

export const GOAL_ACTIONS = ["pause", "resume", "archive", "delete"] as const;
export type GoalAction = (typeof GOAL_ACTIONS)[number];

/** The rules applied to the state, worked out once for whoever shows it. */
export interface Derived {
  subtasks: Record<
    string,
    {
      waits: Wait[];
      actions: SubtaskAction[];
      redone: string[];
      /** Who reviews it, while its review is under way. */
      reviewedBy?: string;
    }
  >;
  /** What can be done to the goal. */
  goal: GoalAction[];
  busy: string[];
  /** Meetings that stopped before their plan and can go on from there. */
  resumable: string[];
}

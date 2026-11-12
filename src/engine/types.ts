/**
 * The team's state as the engine keeps it (docs/design.md §2, §4). Members
 * are named by their file in the team folder; everything here refers to them
 * by that name. What anything waits on is never stored: derive.ts works it
 * out from this.
 */

export const GOAL_STATUSES = ["active", "paused", "archived"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** One goal, on a branch of its own cut from your HEAD when it started (§5). */
export interface Goal {
  id: string;
  name: string;
  /** Its name in git: its branches are under `openplan/<slug>/` (git.ts). */
  slug: string;
  status: GoalStatus;
  createdAt: number;
  /** When it was archived, while it is. */
  archivedAt?: number;
}

/** A group of subtasks that is accepted as a whole. */
export interface Task {
  id: string;
  goalId: string;
  title: string;
  /** What it delivers when accepted. */
  outcome: string;
  createdAt: number;
  /** The meeting whose approved plan it came from; none when assigned directly. */
  meetingId?: string;
}

export const SUBTASK_STATUSES = [
  "pending",
  "running",
  "reviewing",
  "merging",
  "done",
  "failed",
  "stopped",
] as const;
export type SubtaskStatus = (typeof SUBTASK_STATUSES)[number];

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
export type GoOnReason =
  "held" | "carried" | "continued" | "rejected" | "conflict" | "redo" | "revised";

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
  goalId: string;
  title: string;
  description: string;
  acceptance: string;
  assignee: string;
  dependsOn: string[];
  status: SubtaskStatus;
  createdAt: number;
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

export const MEETING_STATUSES = ["running", "review", "approved", "cancelled", "failed"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

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
export interface MeetingSeat {
  session: string;
  heard: number;
}

export interface Meeting {
  id: string;
  goalId: string;
  /** What the meeting is to plan. */
  agenda: string;
  size: MeetingSize;
  /** The host first. */
  participants: string[];
  host: string;
  status: MeetingStatus;
  turns: MeetingTurn[];
  /** Who is speaking now. */
  speaking?: string;
  /** The host is writing the plan. */
  planning?: boolean;
  /** The participants are deciding whether to speak next. */
  weighing?: boolean;
  hands?: MeetingHand[];
  seats?: Record<string, MeetingSeat>;
  plan?: Plan;
  /** Where the approved plan was written. */
  planFile?: string;
  tokens: number;
  error?: string;
  createdAt: number;
}

export type QuestionStatus = "open" | "answered" | "cancelled";

/** One multiple-choice question, as Claude Code's AskUserQuestion puts it. */
export interface Choice {
  question: string;
  header: string;
  options: { label: string; description: string; preview?: string }[];
  multiSelect: boolean;
}

/** What you can decide on a stuck review, a merge that needs you, or a finished task. */
export type DecisionOption =
  "rereview" | "skip" | "sendBack" | "ours" | "theirs" | "retry" | "accept" | "revise";

export type DecisionKind = "review" | "merge" | "delivery";

/** The answers a permission request offers. */
export type PermissionOption = "once" | "always" | "deny";

/** Something a member waits on, or a decision that waits on you (§4.4). */
export interface Question {
  id: string;
  subtaskId?: string;
  /** Who asks. */
  from: string;
  /** A member's name, or "you". */
  to: string;
  text: string;
  /** Answers the asker suggested for a reply in words. */
  options: string[];
  choices?: Choice[];
  status: QuestionStatus;
  createdAt: number;
  /** A call the scheduler acts on; no run waits on it. `files`: conflicts that can't be merged line by line. */
  decision?: { kind: DecisionKind; options: DecisionOption[]; files?: string[] };
  /** A tool call waiting to be allowed: the tool and what it works on. */
  permission?: { tool: string; detail: string; options: PermissionOption[] };
}

/** The addressee of a question put to you. */
export const YOU = "you";

/** The state the engine saves. */
export interface TeamState {
  goals: Goal[];
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
  | { kind: "teammate"; by: string; questionId: string }
  | { kind: "you"; questionId: string; decision?: DecisionKind }
  /** Upstream work in another task, done, whose task waits for your acceptance. */
  | { kind: "acceptance"; questionId: string };

export const SUBTASK_ACTIONS = ["stop", "continue", "retry", "redo"] as const;
export type SubtaskAction = (typeof SUBTASK_ACTIONS)[number];

export const GOAL_ACTIONS = ["pause", "resume", "archive", "delete"] as const;
export type GoalAction = (typeof GOAL_ACTIONS)[number];

/** The rules applied to the state, worked out once for whoever shows it. */
export interface Derived {
  subtasks: Record<string, { waits: Wait[]; actions: SubtaskAction[]; redone: string[] }>;
  goals: Record<string, GoalAction[]>;
  busy: string[];
  /** Meetings that stopped before their plan and can go on from there. */
  resumable: string[];
}

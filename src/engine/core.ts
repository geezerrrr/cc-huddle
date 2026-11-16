/**
 * What the engine's parts share (docs/design.md §3.1): the state, the team,
 * where the work lives, and how a member's turn is set up and followed. The
 * engine makes one per goal it opens.
 */
import type { Work } from "./derive.ts";
import type { Places } from "./git.ts";
import type { MemberOptions } from "./policy.ts";
import type { SessionKind } from "./prompts.ts";
import type { Inbox } from "./questions.ts";
import type { TurnListener } from "./turns.ts";
import type { Goal, GoalState, Meeting, MeetingNow, Member, Question, Subtask } from "./types.ts";

/** The team as configured (§6): its members in order, and cc-huddle's own settings. */
export interface Team {
  members: readonly Member[];
  /** Deliveries are reviewed before they are merged. */
  review: boolean;
}

export interface Core extends Inbox {
  state: GoalState;
  team: Team;
  places: Places;
  /** The Agent SDK options of a member's turn of `kind` in `cwd`: their settings and system prompt. */
  options(member: Member, kind: SessionKind, cwd: string): MemberOptions;
  /** Where what a subtask's runs do is told: its record, and whoever follows it live. */
  recorder(subtask: Subtask): TurnListener;
  /** Where what is said at a meeting is told as it is said, to whoever follows it. */
  speech(meeting: Meeting): TurnListener;
  /** The subtasks whose review or merge is under way now (Scheduler.underWay). */
  underWay(): readonly string[];
  /** What goes on at each running meeting now (Meetings.now). */
  meetingsNow(): Readonly<Record<string, MeetingNow>>;
  /** What members' turns wait on now (Questions.now). */
  questionsNow(): readonly Question[];
}

/** The state as the rules read it (derive.ts). */
export const workOf = (
  core: Pick<Core, "state" | "team" | "underWay" | "meetingsNow" | "questionsNow">,
): Work => ({
  ...core.state,
  questions: [...core.state.questions, ...core.questionsNow()],
  members: core.team.members.map((m) => m.name),
  underWay: core.underWay(),
  meetingsNow: core.meetingsNow(),
});

/** Why what you asked can't be done, as more than one part refuses it. */
export const REFUSED = {
  archived: (goal: Goal) => `The goal "${goal.name}" is archived: resume it first`,
  noMember: (name: string) => `There is no member called "${name}"`,
};

/** Counts `tokens` to the member whose session used them. */
export function spend(state: GoalState, member: string, tokens: number) {
  state.tokens[member] = (state.tokens[member] ?? 0) + tokens;
}

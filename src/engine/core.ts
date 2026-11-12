/**
 * What the engine's parts share (docs/design.md §3.1): the state, the team,
 * where the work lives, and how a member's turn is set up and followed. The
 * engine makes one per repository.
 */
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { Work } from "./derive.ts";
import type { Places } from "./git.ts";
import type { SessionKind } from "./prompts.ts";
import type { Inbox } from "./questions.ts";
import type { TurnListener } from "./turns.ts";
import type { Meeting, Member, Subtask, TeamState } from "./types.ts";

/** The team as configured (§6): its members in order, and openplan's own settings. */
export interface Team {
  members: readonly Member[];
  /** Deliveries are reviewed before they are merged. */
  review: boolean;
}

export interface Core extends Inbox {
  state: TeamState;
  team: Team;
  places: Places;
  /** The Agent SDK options of a member's turn of `kind` in `cwd`: their settings and system prompt. */
  options(member: Member, kind: SessionKind, cwd: string): Options;
  /** Where what a subtask's runs do is told: its record and the pane. */
  recorder(subtask: Subtask): TurnListener;
  /** Where what is said at a meeting is told as it is said: the pane. */
  speech(meeting: Meeting, speaker: string): TurnListener;
}

/** The state as the rules read it (derive.ts). */
export const workOf = (core: Pick<Core, "state" | "team">): Work => ({
  ...core.state,
  members: core.team.members.map((m) => m.name),
});

/** An error in words. */
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

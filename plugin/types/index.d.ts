/**
 * What openplan's pane draws, as the MCP server serves it on `POST /view`
 * (src/plugin/pane.ts in the repository), all its words made there, and the
 * values the mod keeps for the session.
 */

/** The team as the pane shows it; it comes again only when it changed. */
export type OpenplanTeam = {
  /** The goal your session runs; absent while it runs none. */
  goal?: { name: string; slug: string };
  /** Why your session runs no goal, and what to do; absent while it runs one. */
  noGoal?: string;
  /** The band's words: what goes on, and what waits on you. Absent with nothing to say. */
  band?: string;
  /** A line for each task not yet done, under the band: its title and where it stands. */
  tasks: string[];
  meeting?: OpenplanMeeting;
  members: OpenplanMember[];
  needs: OpenplanNeed[];
  /** Milestones so far, each told once, by a key that names it. */
  milestones: { key: string; text: string }[];
  /** What needs a conversation with you, by a key that names it: your session is prompted with each new one. */
  prompts: { key: string; text: string }[];
  /**
   * What `/openplan resume` picks from, each named with how far it got and
   * where it is: your session's goal while it isn't active, then the
   * repository's goals your session doesn't run, oldest first.
   */
  resumable: { slug: string; label: string }[];
  /** Why `/openplan resume` takes nothing up now: your session's goal is under way. */
  resumeRefused?: string;
};

export type OpenplanMeeting = {
  /** What it is about, in a line: its goal's name. */
  about: string;
  /** The brief it was given. */
  agenda: string;
  /** Its state in words: who speaks, the host writing the plan, the plan out for review. */
  status: string;
  /** Who is at it, and who hosts it, in words. */
  attendance: string;
  turns: { speaker: string; text: string; to?: string }[];
  /** Raised hands: who, and what they'd say. */
  hands: { member: string; point: string }[];
  /** The plan's summary, once there is one. */
  plan?: string;
};

export type OpenplanMember = {
  name: string;
  role: string;
  model?: string;
  /** What they do now, in words. */
  doing: string;
  /** The subtask their record follows: the one they work on, or worked on last. */
  subtask?: string;
  tokens: number;
};

/** Something that waits on you, in words, with the answers it takes. */
export type OpenplanNeed = {
  id: string;
  from: string;
  /** What waits on you, in a sentence. */
  headline: string;
  /** More of it: what Claude Code says the call does, a stuck review's notes, the files a merge can't take. */
  detail?: string;
  /** Whether it is put to you in a question dialog; a task to accept is your session's to ask. */
  ask: boolean;
} & (
  | {
      kind: "choices";
      choices: {
        question: string;
        header: string;
        options: { label: string; description?: string }[];
        multiSelect: boolean;
      }[];
    }
  | {
      kind: "options";
      /** The buttons: what the `answer` tool takes as `option`, and its label; the one to press first is `primary`. */
      options: { value: string; label: string; primary?: true }[];
      /** The option a note typed instead of a pick goes with, which may be no button: it is no answer without a note. */
      note?: { option: string; label: string; prompt: string };
      /** The subtasks a task can be sent back to, for its note's option. */
      sendBack?: { id: string; title: string }[];
    }
);

/** A tool call: its name and the argument its line shows. */
export type OpenplanCall = { name: string; argument?: string };

/** One whole thing a member's run did, as its record keeps it (src/engine/records.ts). */
export type OpenplanEntry =
  | { kind: "run"; model: string }
  | { kind: "thinking" | "text"; text: string }
  | ({ kind: "tool"; state: "done" | "error"; output: string } & OpenplanCall)
  | { kind: "steps"; steps: { content: string; status: "pending" | "in_progress" | "completed" }[] }
  /** What the Agent SDK reported, in words. */
  | { kind: "notice"; text: string };

/** What a run does now, not in its entries yet. */
export type OpenplanLive = {
  streaming?: { kind: "thinking" | "text"; text: string };
  starting?: string;
  running: OpenplanCall[];
};

/** A member's record as the pane follows it. */
export type OpenplanRecord = {
  member: string;
  subtask: string;
  /** The last of its entries. */
  entries: OpenplanEntry[];
  /** Where the next read starts. */
  next: number;
  live?: OpenplanLive;
};

/** The meeting turn being spoken: who, what it did so far, and what it does now. */
export type OpenplanSpeaking = { speaker: string; entries: OpenplanEntry[]; live: OpenplanLive };

/** What `view` gives the pane. */
export type OpenplanView = {
  revision: number;
  /** Only when it isn't the revision the pane has. */
  team?: OpenplanTeam;
  /** The turn being spoken at the meeting shown, as it is said. */
  speaking?: OpenplanSpeaking;
  record?: Omit<OpenplanRecord, "member">;
};

export type OpenplanTab = "meeting" | "team" | "needs";

declare module "claude-code" {
  interface PluginState {
    openplan: {
      team: Shaped<OpenplanTeam | null>;
      speaking: Shaped<OpenplanSpeaking | null>;
      record: Shaped<OpenplanRecord | null>;
      /** Why there is no team to show. */
      problem: string | null;
      tab: OpenplanTab;
      /** Picks made on a need not answered yet, by its id. */
      picks: Record<string, string[]>;
    };
  }
}

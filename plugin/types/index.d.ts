/**
 * What openplan's pane draws, as the MCP server's `view` tool gives it
 * (src/plugin/pane.ts in the repository), and the values the mod keeps for the session.
 */

/** The team as the pane shows it; it comes again only when it changed. */
export type OpenplanTeam = {
  /** The band's words: what goes on, and what waits on you. Absent with nothing to say. */
  band?: string;
  meeting?: OpenplanMeeting;
  members: OpenplanMember[];
  needs: OpenplanNeed[];
  /** Milestones so far, each told once, by a key that names it. */
  milestones: { key: string; text: string }[];
  /** What needs a conversation with you, by a key that names it: your session is prompted with each new one. */
  prompts: { key: string; text: string }[];
};

export type OpenplanMeeting = {
  id: string;
  agenda: string;
  /** Its state in words: who speaks, the host writing the plan, the plan out for review. */
  status: string;
  /** The host first. */
  participants: string[];
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

/** Something that waits on you, with the answers it takes. */
export type OpenplanNeed = {
  id: string;
  from: string;
  /** What it is about: the subtask's title, or the goal. */
  about: string;
  text: string;
} & (
  | {
      kind: "permission";
      /** The call, in a line: the tool and what it would do. */
      call: string;
      options: ("once" | "always" | "deny")[];
    }
  | {
      kind: "choices";
      choices: { question: string; header: string; options: string[]; multiSelect: boolean }[];
    }
  | {
      kind: "decision";
      options: string[];
      /** The subtasks a task can be sent back to, for `revise`. */
      sendBack?: { id: string; title: string }[];
    }
);

/** One whole thing a member's run did, as its record keeps it (src/engine/records.ts). */
export type OpenplanEntry = { at: number } & (
  | { kind: "run"; session: string; model: string }
  | { kind: "thinking" | "text"; text: string }
  | { kind: "tool"; name: string; input: unknown; state: "done" | "error"; output: string }
  | { kind: "steps"; steps: { content: string; status: "pending" | "in_progress" | "completed" }[] }
  | { kind: "notice"; notice: { kind: string } & Record<string, unknown> }
);

/** A member's record as the pane follows it. */
export type OpenplanRecord = {
  member: string;
  subtask: string;
  /** The last of its entries. */
  entries: OpenplanEntry[];
  /** Where the next read starts. */
  next: number;
  /** What streams now. */
  live?: {
    streaming?: { kind: "thinking" | "text"; text: string };
    starting?: string;
    running: { name: string; input: unknown }[];
  };
};

/** What `view` gives the pane. */
export type OpenplanView = {
  revision: number;
  /** Only when it isn't the revision the pane has. */
  team?: OpenplanTeam;
  /** The turn being spoken at the meeting shown, as it is said. */
  speaking?: { speaker: string; text: string };
  record?: Omit<OpenplanRecord, "member">;
};

export type OpenplanTab = "meeting" | "team" | "needs";

declare module "claude-code" {
  interface PluginState {
    openplan: {
      team: Shaped<OpenplanTeam | null>;
      speaking: { speaker: string; text: string } | null;
      record: Shaped<OpenplanRecord | null>;
      /** Why there is no team to show. */
      problem: string | null;
      tab: OpenplanTab;
      /** Picks made on a need not answered yet, by its id. */
      picks: Record<string, string[]>;
    };
  }
}

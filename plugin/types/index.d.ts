/**
 * The contract between cc-huddle's mod and its MCP server, both ways: what
 * the mod asks `POST /view` for (`HuddleAsk`) and what it draws from the
 * answer (src/plugin/pane.ts in the repository), all its words made there;
 * what the `answer` tool takes (`HuddleAnswer`); and the values the mod
 * keeps for the session.
 */

/** The team as the pane shows it; it comes again only when it changed. */
export type HuddleTeam = {
  /** Why your session runs no goal, and what to do; absent while it runs one. */
  noGoal?: string;
  /**
   * How many goals your session has taken up or started: a new count is a
   * goal just opened here, whose milestones so far are not news.
   */
  opened: number;
  /** The band's words: what goes on, and what waits on you. Absent with nothing to say. */
  band?: string;
  /** A line for each task not yet done, under the band: its title and where it stands. */
  tasks: string[];
  meeting?: HuddleMeeting;
  members: HuddleMember[];
  needs: HuddleNeed[];
  /** Milestones so far, each told once, by a key that names it. */
  milestones: { key: string; text: string }[];
  /**
   * What `/huddle resume` picks from, each named with how far it got and
   * where it is: your session's goal while it isn't active, then the
   * repository's goals your session doesn't run, oldest first.
   */
  resumable: { slug: string; label: string }[];
  /** Why `/huddle resume` takes nothing up now: your session's goal is under way, or there is none to take up. */
  resumeRefused?: string;
  /** Why `/huddle pause` pauses nothing now: your session runs no goal, or its goal isn't under way. */
  pauseRefused?: string;
};

export type HuddleMeeting = {
  /** What it is about and where it is, in a line: its goal's name, who speaks, the plan out for review. */
  heading: string;
  /** Who is at it, and who hosts it, in words. */
  attendance: string;
  /** The brief it was given. */
  agenda: string;
  /** Each turn: who spoke, to whom it gave the word, and what they said. */
  turns: { heading: string; text: string }[];
  /** The raised hands, in a sentence: who, and what they'd say. */
  hands?: string;
  /** The plan's summary in a sentence, once there is one. */
  plan?: string;
};

export type HuddleMember = {
  name: string;
  /** Their role, model and tokens, in a line. */
  line: string;
  /** What they do now, in words. */
  doing: string;
  /** Whether they have a record to follow: a subtask they work on, or worked on. */
  followable: boolean;
};

/** Something that waits on you, in words, with the answers it takes. */
export type HuddleNeed = {
  id: string;
  from: string;
  /** What waits on you, in a sentence. */
  headline: string;
  /** More of it: what Claude Code says the call does, a stuck review's notes, the files a merge can't take. */
  detail?: string;
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
      options: { value: HuddleOption; label: string; primary?: true }[];
      /** The option a note typed instead of a pick goes with, which may be no button: it is no answer without a note. */
      note?: { option: HuddleOption; label: string; prompt: string };
      /** The subtasks a task can be sent back to, for its note's option, when there is more than one. */
      sendBack?: { id: string; title: string }[];
    }
  | {
      /** A plan out for review: approve it, picking the tasks you accept by number, drop it, or type a change. */
      kind: "plan";
      /** The meeting whose plan it is, as `review_plan` takes it. */
      meeting: string;
      /** The plan's document in full, for the pane. */
      document: string;
      /** Its tasks' titles, in order: the ones you accept are picked by their place. */
      tasks: string[];
    }
);

/** What a permission or a decision can be answered with. */
export type HuddleOption =
  | "once"
  | "always"
  | "deny"
  | "rereview"
  | "skip"
  | "sendBack"
  | "ours"
  | "theirs"
  | "retry"
  | "stop"
  | "accept"
  | "revise";

/**
 * What the `answer` tool takes as `answer`, as you pressed or typed it: an
 * option, with a note where you typed one and the subtask a revised task goes
 * back to where you picked one; or a pick for each question with choices.
 */
export type HuddleAnswer =
  | { kind: "option"; option: HuddleOption; note?: string; sentBack?: string }
  | { kind: "choices"; picks: string[] };

/** What you decided on a plan out for review, as `review_plan` takes it for its meeting. */
export type HuddlePlanDecision = Omit<HuddleCalls["review_plan"], "meeting">;

/** What the mod calls each of the server's tools with. */
export type HuddleCalls = {
  pane: Record<string, never>;
  status: Record<string, never>;
  answer: { question: string; answer: HuddleAnswer };
  /**
   * A plan out for review, as you decided: approved, with `accept` the tasks
   * you accept by their place from 0 where you picked them (else as the plan
   * has them); dropped; or changed as you typed (`change`), which gives the
   * prompt your session makes the change with.
   */
  review_plan: {
    meeting: string;
    decision: "approve" | "drop" | "change";
    accept?: number[];
    change?: string;
  };
  hand_off: { task: string };
  resume_goal: { goal: string };
  switch_settings: { review?: boolean; meetingSize?: "small" | "discussion" | "large" };
  goal_action: { action: "pause" | "resume" | "archive" | "delete" };
};

/** A tool call: its name and the argument its line shows. */
export type HuddleCall = { name: string; argument?: string };

/** One whole thing a member's run did, as its record keeps it (src/engine/records.ts). */
export type HuddleEntry =
  /** A run's start, in words: the model it runs on. */
  | { kind: "run"; text: string }
  | { kind: "thinking" | "text"; text: string }
  | ({ kind: "tool"; state: "done" | "error"; output: string } & HuddleCall)
  | { kind: "steps"; steps: { content: string; status: "pending" | "in_progress" | "completed" }[] }
  /** What the Agent SDK reported, in words. */
  | { kind: "notice"; text: string };

/** What a run does now, not in its entries yet. */
export type HuddleLive = {
  streaming?: { kind: "thinking" | "text"; text: string };
  starting?: string;
  running: HuddleCall[];
};

/** What a run did since the pane last read it, where the next read starts, and what it does now. */
export type HuddleRun = { entries: HuddleEntry[]; next: number; live?: HuddleLive };

/** A member's record: of the subtask they work on, or worked on last. */
export type HuddleRecord = HuddleRun & { subtask: string };

/** The meeting turn being spoken: which speech it is, and who speaks it. */
export type HuddleSpeaking = HuddleRun & { speech: string; speaker: string };

/** The member whose record the pane follows, and the record as it has it, once read. */
export type HuddleFollowed = { member: string; record?: HuddleRecord };

/** What the mod asks `POST /view` for. */
export type HuddleAsk = {
  /** The revision of the team the pane has. */
  revision?: number;
  /** The member whose record the pane follows, and the run it read up to which byte, if it read one. */
  record?: { member: string; read?: { subtask: string; next: number } };
  /** The speech at the meeting the pane read as it is spoken, and up to which entry. */
  speaking?: { speech: string; next: number };
};

/** What `view` gives the pane. */
export type HuddleView = {
  revision: number;
  /** Only when it isn't the revision the pane has. */
  team?: HuddleTeam;
  /** The turn being spoken at the meeting shown, as it is said. */
  speaking?: HuddleSpeaking;
  /** The followed member's record since the pane read it. */
  record?: HuddleRecord;
};

export type HuddleTab = "meeting" | "team" | "needs";

declare module "claude-code" {
  interface PluginState {
    "cc-huddle": {
      team: Shaped<HuddleTeam | null>;
      speaking: Shaped<HuddleSpeaking | null>;
      followed: Shaped<HuddleFollowed | null>;
      /** Why there is no team to show. */
      problem: string | null;
      tab: HuddleTab;
      /** Picks made on a question with choices not answered yet, by the need's id. */
      picks: Record<string, string[]>;
      /** The subtask a revised task goes back to, where you picked one, by the need's id. */
      sentBack: Record<string, string>;
    };
  }
}

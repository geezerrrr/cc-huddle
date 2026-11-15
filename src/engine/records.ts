/**
 * Records (docs/design.md §7.2): what each subtask's runs did, kept as a file
 * of whole entries in the data folder, and what is being said or done right
 * now, kept in memory for whoever follows it: the words still streaming, the tool calls
 * not back yet. A meeting turn being spoken is followed the same way, its
 * entries kept in memory until it is the meeting's.
 */
import { appendFile, mkdir, open } from "node:fs/promises";
import path from "node:path";
import { errorCode } from "../shared/errors.ts";
import type { Places } from "./git.ts";
import { goalFiles } from "../shared/layout.ts";
import { inOrder } from "../shared/serial.ts";
import type { Notice, Step, ToolCall, TurnListener } from "./turns.ts";
import type { Meeting } from "./types.ts";

/** How much of a tool's output a record keeps. */
const OUTPUT_MAX = 4000;

/** One whole thing a run did, as its record keeps it. */
export type RecordEntry = { at: number } & (
  | { kind: "run"; session: string; model: string }
  | { kind: "thinking" | "text"; text: string }
  | { kind: "tool"; name: string; input: unknown; state: "done" | "error"; output: string }
  | { kind: "steps"; steps: Step[] }
  | { kind: "notice"; notice: Notice }
);

/** What a run is doing right now, not in its record yet. */
export interface LiveRun {
  /** The words or thinking streaming in. */
  streaming?: { kind: "thinking" | "text"; text: string };
  /** A tool call being written, named before its input is whole. */
  starting?: string;
  /** The calls made and not back yet. */
  running: ToolCall[];
}

/** A meeting turn as it is spoken: who, what it did so far, and what it does now. */
interface Spoken {
  speaker: string;
  entries: RecordEntry[];
  live: LiveRun;
}

/** A run's doing as kept while it goes on: its calls by id. */
interface Now {
  streaming?: LiveRun["streaming"];
  starting?: string;
  running: Map<string, ToolCall>;
}

/** What a run does now, as whoever follows it reads it. */
const liveOf = (now: Now): LiveRun => ({
  ...(now.streaming && { streaming: now.streaming }),
  ...(now.starting && { starting: now.starting }),
  running: [...now.running.values()],
});

/**
 * Where a run tells what it does, for a subtask's record and a meeting turn
 * alike: each whole thing it did goes to `keep`, what it does now to `now`.
 */
function tracking(now: Now, keep: (entry: RecordEntry) => void): TurnListener {
  return {
    session: (session, model) => {
      keep({ at: Date.now(), kind: "run", session, model });
    },
    thinking: (delta) => {
      now.streaming =
        delta === "" || now.streaming?.kind !== "thinking"
          ? { kind: "thinking", text: delta }
          : { kind: "thinking", text: now.streaming.text + delta };
    },
    text: (delta, fresh) => {
      now.streaming =
        fresh || now.streaming?.kind !== "text"
          ? { kind: "text", text: delta }
          : { kind: "text", text: now.streaming.text + delta };
    },
    toolStarting: (name) => {
      now.starting = name;
    },
    block: (block) => {
      if (block.kind === "tool") {
        now.starting = undefined;
        now.running.set(block.id, block);
        return;
      }
      if (now.streaming?.kind === block.kind) now.streaming = undefined;
      keep({ at: Date.now(), kind: block.kind, text: block.text });
    },
    toolDone: (call) => {
      now.running.delete(call.id);
      keep({
        at: Date.now(),
        kind: "tool",
        name: call.name,
        input: call.input,
        state: call.state === "error" ? "error" : "done",
        output: (call.output ?? "").slice(0, OUTPUT_MAX),
      });
    },
    steps: (steps) => {
      keep({ at: Date.now(), kind: "steps", steps });
    },
    notice: (notice) => {
      keep({ at: Date.now(), kind: "notice", notice });
    },
  };
}

/** A meeting turn being spoken: the turn it becomes, and what it did and does. */
interface Speaking {
  speaker: string;
  turn: number;
  entries: RecordEntry[];
  now: Now;
}

export class Records {
  /** What each subtask's run is doing now, by subtask id: its last run's, once it ends. */
  private readonly live = new Map<string, Now>();
  private readonly spoken = new Map<string, Speaking>();
  /** Entries are appended one at a time, in the order they came. */
  private readonly writing: ReturnType<typeof inOrder>;

  constructor(
    private readonly places: Places,
    /** An entry couldn't be written. */
    failed: (error: unknown) => void,
  ) {
    this.writing = inOrder(failed);
  }

  /** Where a run of `subtaskId` tells what it does: its record, and what goes on now. */
  recorder(subtaskId: string): TurnListener {
    const now: Now = { running: new Map() };
    this.live.set(subtaskId, now);
    const file = goalFiles(this.places.root).record(subtaskId);
    const write = (entry: RecordEntry) => {
      this.writing.run(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        await appendFile(file, `${JSON.stringify(entry)}\n`);
      });
    };
    return tracking(now, write);
  }

  /**
   * A subtask's record from byte `from` of its file on: the whole entries
   * written since, where the next read starts, and what its run is doing now.
   */
  async read(
    subtaskId: string,
    from = 0,
  ): Promise<{ entries: RecordEntry[]; next: number; live?: LiveRun }> {
    const now = this.live.get(subtaskId);
    const live = now && liveOf(now);
    let handle;
    try {
      handle = await open(goalFiles(this.places.root).record(subtaskId));
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      return { entries: [], next: 0, ...(live && { live }) };
    }
    try {
      const { size } = await handle.stat();
      const buffer = Buffer.alloc(Math.max(0, size - from));
      await handle.read(buffer, 0, buffer.length, from);
      // A line being appended as this reads is left for the next read.
      const whole = buffer.lastIndexOf("\n") + 1;
      const entries = buffer
        .subarray(0, whole)
        .toString("utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RecordEntry);
      return { entries, next: from + whole, ...(live && { live }) };
    } finally {
      await handle.close();
    }
  }

  /**
   * Where a meeting turn tells what it does as it is spoken, as a run tells
   * its record; kept until it is the meeting's. A turn's start isn't kept:
   * the meeting says who speaks.
   */
  speech(meeting: Meeting, speaker: string): TurnListener {
    const speaking: Speaking = {
      speaker,
      turn: meeting.turns.length,
      entries: [],
      now: { running: new Map() },
    };
    this.spoken.set(meeting.id, speaking);
    return tracking(speaking.now, (entry) => {
      if (entry.kind !== "run") speaking.entries.push(entry);
    });
  }

  /** The turn being spoken at `meeting` now, if one is. */
  speaking(meeting: Meeting): Spoken | undefined {
    const speaking = this.spoken.get(meeting.id);
    if (meeting.status !== "running" || speaking?.turn !== meeting.turns.length) return undefined;
    return { speaker: speaking.speaker, entries: speaking.entries, live: liveOf(speaking.now) };
  }

  /** Every entry written so far is in its file. */
  flush(): Promise<void> {
    return this.writing.idle();
  }
}

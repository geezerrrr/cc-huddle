/**
 * Records (docs/design.md §7.2): what each subtask's runs did, kept as a file
 * of whole entries in the data folder, and what is being said or done right
 * now, kept in memory for the pane: the words still streaming, the tool calls
 * not back yet, the meeting turn being spoken.
 */
import { appendFile, mkdir, open } from "node:fs/promises";
import path from "node:path";
import type { Places } from "./git.ts";
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

/** A meeting turn as it is spoken: who, what so far, and which turn it becomes. */
export interface Spoken {
  speaker: string;
  text: string;
  turn: number;
}

/** A run's doing as kept while it goes on: its calls by id. */
interface Now {
  streaming?: LiveRun["streaming"];
  starting?: string;
  running: Map<string, ToolCall>;
}

/** A subtask's record file. */
export const recordFile = (places: Places, subtaskId: string) =>
  path.join(places.root, "records", `${subtaskId}.jsonl`);

export class Records {
  /** What each subtask's run is doing now, by subtask id: its last run's, once it ends. */
  private readonly live = new Map<string, Now>();
  private readonly spoken = new Map<string, Spoken>();
  /** Entries are appended one at a time, in the order they came. */
  private writing = Promise.resolve();

  constructor(
    private readonly places: Places,
    /** An entry couldn't be written. */
    private readonly failed: (error: unknown) => void,
  ) {}

  /** Where a run of `subtaskId` tells what it does: its record, and what goes on now. */
  recorder(subtaskId: string): TurnListener {
    const now: Now = { running: new Map() };
    this.live.set(subtaskId, now);
    const file = recordFile(this.places, subtaskId);
    const write = (entry: RecordEntry) => {
      this.writing = this.writing
        .then(async () => {
          await mkdir(path.dirname(file), { recursive: true });
          await appendFile(file, `${JSON.stringify(entry)}\n`);
        })
        .catch(this.failed);
    };
    return {
      session: (session, model) => {
        write({ at: Date.now(), kind: "run", session, model });
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
        write({ at: Date.now(), kind: block.kind, text: block.text });
      },
      toolDone: (call) => {
        now.running.delete(call.id);
        write({
          at: Date.now(),
          kind: "tool",
          name: call.name,
          input: call.input,
          state: call.state === "error" ? "error" : "done",
          output: (call.output ?? "").slice(0, OUTPUT_MAX),
        });
      },
      steps: (steps) => {
        write({ at: Date.now(), kind: "steps", steps });
      },
      notice: (notice) => {
        write({ at: Date.now(), kind: "notice", notice });
      },
    };
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
    const live = now && {
      ...(now.streaming && { streaming: now.streaming }),
      ...(now.starting && { starting: now.starting }),
      running: [...now.running.values()],
    };
    let handle;
    try {
      handle = await open(recordFile(this.places, subtaskId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
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

  /** Where a meeting turn tells its words as they are said. */
  speech(meeting: Meeting, speaker: string): TurnListener {
    const spoken: Spoken = { speaker, text: "", turn: meeting.turns.length };
    this.spoken.set(meeting.id, spoken);
    return {
      // What a turn says before it looks something up isn't what it ends up saying.
      text: (delta, fresh) => {
        spoken.text = fresh ? delta : spoken.text + delta;
      },
    };
  }

  /** The turn being spoken at `meeting` now, if one is. */
  speaking(meeting: Meeting): Spoken | undefined {
    const spoken = this.spoken.get(meeting.id);
    return meeting.status === "running" && spoken?.turn === meeting.turns.length
      ? spoken
      : undefined;
  }

  /** Every entry written so far is in its file. */
  flush(): Promise<void> {
    return this.writing;
  }
}

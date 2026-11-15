import { appendFile, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Places } from "./git.ts";
import { Records } from "./records.ts";
import type { ToolCall } from "./turns.ts";
import type { Meeting } from "./types.ts";
import { goalFiles } from "../shared/layout.ts";

let dir: string;
let places: Places;
let records: Records;
const failed = vi.fn();

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-records-")));
  places = { repo: { top: dir, common: dir }, slug: "dice", root: dir };
  records = new Records(places, failed);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const call: ToolCall = {
  kind: "tool",
  id: "c1",
  name: "Read",
  input: { file_path: "README.md" },
  state: "running",
};

describe("Records", () => {
  it("keep what a run did, whole, and tell what it is doing now", async () => {
    const run = records.recorder("s1");
    run.session?.("sess-1", "glm-5");
    run.thinking?.("");
    run.thinking?.("Where is ");
    run.thinking?.("the readme?");
    expect((await records.read("s1")).live).toEqual({
      streaming: { kind: "thinking", text: "Where is the readme?" },
      running: [],
    });
    run.block?.({ kind: "thinking", text: "Where is the readme?" });
    run.toolStarting?.("Read");
    expect((await records.read("s1")).live).toEqual({ starting: "Read", running: [] });
    run.block?.(call);
    expect((await records.read("s1")).live).toEqual({ running: [call] });
    run.toolDone?.({ ...call, state: "done", output: "x".repeat(5000) });
    run.text?.("Read it.", true);
    run.block?.({ kind: "text", text: "Read it." });
    await records.flush();

    const { entries, next, live } = await records.read("s1");
    expect(entries).toMatchObject([
      { kind: "run", model: "glm-5" },
      { kind: "thinking", text: "Where is the readme?" },
      {
        kind: "tool",
        name: "Read",
        input: { file_path: "README.md" },
        state: "done",
        output: "x".repeat(4000),
      },
      { kind: "text", text: "Read it." },
    ]);
    expect(live).toEqual({ running: [] });
    expect(next).toBe((await readFile(goalFiles(places.root).record("s1"))).length);

    run.steps?.([{ content: "Write the rules", status: "in_progress" }]);
    await records.flush();
    expect((await records.read("s1", next)).entries).toMatchObject([
      { kind: "steps", steps: [{ content: "Write the rules" }] },
    ]);
    expect(failed).not.toHaveBeenCalled();
  });

  it("read nothing of a subtask that never ran, and leave a line half written for the next read", async () => {
    expect(await records.read("s2")).toEqual({ entries: [], next: 0 });
    records.recorder("s2").notice?.({ kind: "refusal", model: "glm-5" });
    await records.flush();
    const file = goalFiles(places.root).record("s2");
    await appendFile(file, '{"at":1,"kind":"text"');
    const first = await records.read("s2");
    expect(first.entries).toHaveLength(1);
    await appendFile(file, ',"text":"Hi"}\n');
    expect((await records.read("s2", first.next)).entries).toEqual([
      { at: 1, kind: "text", text: "Hi" },
    ]);
  });

  it("follow a meeting turn as a run is followed, kept until it is the meeting's", () => {
    const meeting = {
      id: "m1",
      status: "running",
      turns: [] as Meeting["turns"],
    } as Meeting;
    const speech = records.speech(meeting);
    const read = {
      kind: "tool",
      id: "t1",
      name: "Read",
      input: { file_path: "rules.md" },
    } as const;
    speech.session?.("s1", "glm-5");
    speech.text?.("Let me look.", true);
    speech.block?.({ kind: "text", text: "Let me look." });
    speech.block?.({ ...read, state: "running" });
    expect(records.speaking(meeting)?.live.running).toEqual([{ ...read, state: "running" }]);
    speech.toolDone?.({ ...read, state: "done", output: "Two dice" });
    speech.text?.("Two dice", true);
    speech.text?.(", one reroll.", false);
    const spoken = records.speaking(meeting);
    expect(spoken?.speech).toMatch(/./);
    expect(spoken).toEqual({
      speech: spoken?.speech,
      next: 2,
      entries: [
        { kind: "text", text: "Let me look." },
        {
          kind: "tool",
          name: "Read",
          input: { file_path: "rules.md" },
          state: "done",
          output: "Two dice",
        },
      ],
      live: { streaming: { kind: "text", text: "Two dice, one reroll." }, running: [] },
    });
    expect(records.speaking(meeting, { speech: spoken?.speech ?? "", next: 2 })).toMatchObject({
      entries: [],
      next: 2,
    });
    expect(records.speaking(meeting, { speech: "another", next: 2 })?.entries).toHaveLength(2);
    meeting.turns.push({ speaker: "glm", text: "", phase: "opening" });
    expect(records.speaking(meeting)).toBeUndefined();
  });
});

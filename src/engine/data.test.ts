import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readState, releaseTeam, repoFolder, stateWriter, takeTeam } from "./data.ts";
import type { TeamState } from "./types.ts";

let dir: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-data-")));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const empty = (): TeamState => ({
  goals: [],
  tasks: [],
  subtasks: [],
  meetings: [],
  questions: [],
});

describe("repoFolder", () => {
  it("is one for a repository and its worktrees, and another for another repository", () => {
    const at = (top: string, common: string) => repoFolder("/data", { top, common });
    expect(at("/code/dice game", "/code/dice game/.git")).toMatch(
      /^\/data\/repos\/dice-game-[0-9a-f]{12}$/,
    );
    expect(at("/elsewhere/dice-wt", "/code/dice game/.git").slice(-12)).toBe(
      at("/code/dice game", "/code/dice game/.git").slice(-12),
    );
    expect(at("/other/dice game", "/other/dice game/.git")).not.toBe(
      at("/code/dice game", "/code/dice game/.git"),
    );
  });
});

describe("the state file", () => {
  it("starts empty, and is written a moment after a change, or at once when flushed", async () => {
    const file = path.join(dir, "repo", "state.json");
    const state = await readState(file);
    expect(state).toEqual(empty());
    const writer = stateWriter(file, () => state, vi.fn());
    state.goals.push({ id: "g1", name: "Dice", slug: "dice", status: "active", createdAt: 0 });
    writer.changed();
    writer.changed();
    await vi.waitFor(async () => {
      expect(await readState(file)).toEqual(state);
    });
    state.goals = [];
    writer.changed();
    await writer.flush();
    expect(await readState(file)).toEqual(empty());
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ version: 1 });
  });

  it("tells a write that failed", async () => {
    await writeFile(path.join(dir, "blocked"), "");
    const failed = vi.fn();
    const writer = stateWriter(path.join(dir, "blocked", "state.json"), empty, failed);
    writer.changed();
    await writer.flush();
    expect(failed).toHaveBeenCalledOnce();
  });

  it("isn't taken when it can't be read or comes from a newer openplan", async () => {
    const file = path.join(dir, "state.json");
    await writeFile(file, "{");
    await expect(readState(file)).rejects.toThrow("can't be read");
    await writeFile(file, JSON.stringify({ version: 2, state: empty() }));
    await expect(readState(file)).rejects.toThrow("written by a newer openplan");
  });
});

describe("the lock", () => {
  it("gives the team to one running process, and is let go of by its holder", async () => {
    const lock = path.join(dir, "repo", "lock");
    await takeTeam(lock);
    await takeTeam(lock);
    const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    await once(other, "spawn");
    await writeFile(lock, String(other.pid));
    releaseTeam(lock);
    await expect(takeTeam(lock)).rejects.toThrow(`(pid ${String(other.pid)})`);
    other.kill();
    await once(other, "exit");
    await takeTeam(lock);
    expect(await readFile(lock, "utf8")).toBe(String(process.pid));
    releaseTeam(lock);
    await expect(stat(lock)).rejects.toThrow();
  });
});

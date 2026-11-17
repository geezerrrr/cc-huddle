import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { goalFiles, goalsFolder, repoFolder } from "../shared/layout.ts";
import { listGoals, newGoalFolder, readState, stateWriter } from "./data.ts";
import type { GoalState } from "./types.ts";
import { releaseLock, takeLock } from "./lock.ts";

let dir: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "huddle-data-")));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const fresh = (slug = "dice", createdAt = 0): GoalState => ({
  goal: {
    name: "Dice",
    slug,
    status: "active",
    createdAt,
    settings: { review: true, meetingSize: "discussion", parallel: false },
  },
  tasks: [],
  subtasks: [],
  meetings: [],
  questions: [],
  tokens: {},
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
  it("is written a moment after a change, or at once when flushed", async () => {
    const file = path.join(dir, "repo", "state.json");
    const state = fresh();
    const writer = stateWriter(file, () => state, vi.fn());
    writer.changed();
    writer.changed();
    await vi.waitFor(async () => {
      expect(await readState(file)).toEqual(state);
    });
    state.goal.status = "paused";
    writer.changed();
    await writer.flush();
    expect((await readState(file)).goal.status).toBe("paused");
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ version: 6 });
  });

  it("tells a write that failed", async () => {
    await writeFile(path.join(dir, "blocked"), "");
    const failed = vi.fn();
    const writer = stateWriter(path.join(dir, "blocked", "state.json"), fresh, failed);
    writer.changed();
    await writer.flush();
    expect(failed).toHaveBeenCalledOnce();
  });

  it("isn't taken when it can't be read or comes from a newer cc-huddle", async () => {
    const file = path.join(dir, "state.json");
    await writeFile(file, "{");
    await expect(readState(file)).rejects.toThrow("can't be read");
    await writeFile(file, JSON.stringify({ version: 7, state: fresh() }));
    await expect(readState(file)).rejects.toThrow("written by a newer cc-huddle");
  });
});

describe("a repository's goals", () => {
  it("each get a folder of their own, named by a slug no goal has", async () => {
    const repo = path.join(dir, "repo");
    const taken = new Set(["dice-3"]);
    const made = await Promise.all([
      newGoalFolder(repo, "Dice", taken),
      newGoalFolder(repo, "Dice", taken),
    ]);
    const next = await newGoalFolder(repo, "Dice", new Set(["dice-3"]));
    expect(made.map((m) => m.slug).sort()).toEqual(["dice", "dice-2"]);
    expect(next).toEqual({ slug: "dice-4", folder: path.join(goalsFolder(repo), "dice-4") });
  });

  it("are listed oldest first, with who runs each, but a folder with no state yet, and one that can't be read with why", async () => {
    const repo = path.join(dir, "repo");
    expect(await listGoals(repo)).toEqual([]);
    const write = async (slug: string, createdAt: number) => {
      const files = goalFiles(path.join(goalsFolder(repo), slug));
      const writer = stateWriter(files.state, () => fresh(slug, createdAt), vi.fn());
      writer.changed();
      await writer.flush();
      return files;
    };
    const chess = await write("chess", 2);
    await write("dice", 1);
    await mkdir(path.join(goalsFolder(repo), "starting"));
    const old = goalFiles(path.join(goalsFolder(repo), "old"));
    await mkdir(path.dirname(old.state));
    await writeFile(old.state, JSON.stringify({ version: 1, state: {} }));
    const me = { session: 41, address: "here" };
    await takeLock(chess.lock, me, () => Promise.reject(new Error("held")));
    expect(await listGoals(repo)).toEqual([
      { slug: "dice", state: fresh("dice", 1) },
      { slug: "chess", state: fresh("chess", 2), holder: { pid: process.pid, ...me } },
      // One that can't be read is listed last, with why, the rest all the same.
      { slug: "old", unreadable: expect.stringContaining("before its first release") as string },
    ]);
    releaseLock(chess.lock);
  });
});

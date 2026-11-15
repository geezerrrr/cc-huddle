import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  goalFiles,
  goalsFolder,
  holderOf,
  listGoals,
  newGoalFolder,
  openedGoal,
  readState,
  releaseGoal,
  repoFolder,
  stateWriter,
  takeGoal,
  type Holder,
} from "./data.ts";
import type { GoalState } from "./types.ts";

let dir: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-data-")));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const fresh = (slug = "dice", createdAt = 0): GoalState => ({
  goal: { id: slug, name: "Dice", slug, status: "active", createdAt },
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
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ version: 1 });
  });

  it("tells a write that failed", async () => {
    await writeFile(path.join(dir, "blocked"), "");
    const failed = vi.fn();
    const writer = stateWriter(path.join(dir, "blocked", "state.json"), fresh, failed);
    writer.changed();
    await writer.flush();
    expect(failed).toHaveBeenCalledOnce();
  });

  it("isn't taken when it can't be read or comes from a newer openplan", async () => {
    const file = path.join(dir, "state.json");
    await writeFile(file, "{");
    await expect(readState(file)).rejects.toThrow("can't be read");
    await writeFile(file, JSON.stringify({ version: 2, state: fresh() }));
    await expect(readState(file)).rejects.toThrow("written by a newer openplan");
  });
});

/** The session the goal is taken for, and where it is asked to let it go. */
const SESSION = 41;
const ME = { session: SESSION, address: "here" };

/** A holder that won't let the goal go. */
const refuse = (holder: Holder) => Promise.reject(new Error(`held by ${String(holder.session)}`));

describe("the lock", () => {
  it("gives the goal to one running process, and is let go of by its holder", async () => {
    const lock = path.join(dir, "repo", "lock");
    await takeGoal(lock, ME, refuse);
    await takeGoal(lock, ME, refuse);
    const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    await once(other, "spawn");
    await writeFile(
      lock,
      JSON.stringify({ pid: other.pid, session: 7, address: "there", open: true }),
    );
    releaseGoal(lock);
    await expect(takeGoal(lock, ME, refuse)).rejects.toThrow("held by 7");
    other.kill();
    await once(other, "exit");
    expect(holderOf(lock)).toBeUndefined();
    await takeGoal(lock, ME, refuse);
    const holder = { pid: process.pid, ...ME };
    expect(holderOf(lock)).toEqual({ ...holder, open: false });
    await openedGoal(lock, ME);
    expect(holderOf(lock)).toEqual({ ...holder, open: true });
    releaseGoal(lock);
    await expect(stat(lock)).rejects.toThrow();
  });

  it("asks a running holder to let the goal go, and gives back what it stopped", async () => {
    const lock = path.join(dir, "repo", "lock");
    const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    await once(other, "spawn");
    await mkdir(path.dirname(lock), { recursive: true });
    await writeFile(
      lock,
      JSON.stringify({ pid: other.pid, session: 7, address: "there", open: true }),
    );
    const asked: string[] = [];
    const handed = await takeGoal(lock, ME, async (holder) => {
      asked.push(holder.address);
      await rm(lock);
      return { meetings: ["m1"] };
    });
    other.kill();
    expect(asked).toEqual(["there"]);
    expect(handed).toEqual({ meetings: ["m1"] });
    expect(holderOf(lock)).toEqual({ pid: process.pid, ...ME, open: false });
    releaseGoal(lock);
  });

  it("goes to one of several sessions starting at once, also over one that has ended", async () => {
    const lock = path.join(dir, "repo", "lock");
    const take = `
      import { takeGoal } from ${JSON.stringify(path.join(import.meta.dirname, "data.ts"))};
      takeGoal(process.argv[1], { session: 1, address: "" }, () => Promise.reject(new Error("held"))).then(() => console.log("took"), () => console.log("refused"));
      setTimeout(() => {}, 2000);
    `;
    const race = async () => {
      const takers = Array.from({ length: 6 }, () =>
        spawn(process.execPath, [
          "--experimental-transform-types",
          "--no-warnings",
          "--input-type=module",
          "-e",
          take,
          lock,
        ]),
      );
      const said = await Promise.all(
        takers.map(async (taker) => {
          const [line] = (await once(taker.stdout, "data")) as [Buffer];
          return line.toString().trim();
        }),
      );
      // Ended once all have tried, the taker leaves the lock behind.
      for (const taker of takers) taker.kill();
      await Promise.all(takers.map((taker) => once(taker, "exit")));
      return said.filter((word) => word === "took").length;
    };
    expect([await race(), await race()]).toEqual([1, 1]);
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

  it("are listed oldest first, with who runs each, but a folder with no state yet", async () => {
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
    await takeGoal(chess.lock, ME, refuse);
    expect(await listGoals(repo)).toEqual([
      { slug: "dice", state: fresh("dice", 1) },
      { slug: "chess", state: fresh("chess", 2), holder: { pid: process.pid, ...ME, open: false } },
    ]);
    releaseGoal(chess.lock);
  });
});

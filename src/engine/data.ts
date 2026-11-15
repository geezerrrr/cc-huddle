/**
 * What openplan keeps in its data folder for a repository (docs/design.md
 * §3.2, §3.4): a folder for each goal, with its state, the lock that gives
 * the goal to one session, and where everything else of the goal goes.
 */
import { createHash } from "node:crypto";
import { link, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { errorCode, errorText } from "./core.ts";
import { renameOver, writeWhole } from "./files.ts";
import { goalFiles } from "./goal-files.ts";
import { inOrder } from "./serial.ts";
import { slugFor, type Repository } from "./git.ts";
import { running } from "./running.ts";
import type { GoalState } from "./types.ts";

/**
 * A repository's folder in the data folder: its name, and a hash of its git
 * folder, which its own worktrees share, so they all have the same goals.
 */
export function repoFolder(dataFolder: string, repo: Repository): string {
  const name = path.basename(repo.top).replace(/[^\w.-]+/g, "-");
  const hash = createHash("sha256").update(repo.common).digest("hex").slice(0, 12);
  return path.join(dataFolder, "repos", `${name}-${hash}`);
}

/** The folder of a repository's goals, each in a folder named by its slug. */
export const goalsFolder = (repoFolder: string) => path.join(repoFolder, "goals");

/** The version of `state.json` this openplan writes. */
const STATE_VERSION = 2;

/** How long after a change the state is written: a burst of changes is written once. */
const SAVE_DELAY_MS = 200;

/** A goal's state from its file. Throws when the file can't be read as this openplan's. */
export async function readState(file: string): Promise<GoalState> {
  const text = await readFile(file, "utf8");
  let saved: { version: number; state: GoalState };
  try {
    saved = JSON.parse(text) as typeof saved;
  } catch (error) {
    throw new Error(`${file} can't be read (${errorText(error)}): move it away to start over`, {
      cause: error,
    });
  }
  if (saved.version > STATE_VERSION)
    throw new Error(`${file} was written by a newer openplan: update openplan to go on`);
  if (saved.version < STATE_VERSION)
    throw new Error(
      `${file} was written by an openplan before its first release: move it away to start over`,
    );
  return saved.state;
}

/**
 * Writes the state a moment after it changes (`changed`), and at once on
 * `flush`. Once `close`d it writes no more: the goal is another session's.
 */
export interface StateWriter {
  changed(): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Writes `state` to `file` whole, in one go: a new file renamed over the
 * old, so a crash leaves the last one written. `failed`: a write didn't go.
 */
export function stateWriter(
  file: string,
  state: () => GoalState,
  failed: (error: unknown) => void,
): StateWriter {
  let timer: NodeJS.Timeout | undefined;
  const writing = inOrder(failed);
  let closed = false;
  const write = () => {
    timer = undefined;
    writing.run(() => writeWhole(file, JSON.stringify({ version: STATE_VERSION, state: state() })));
  };
  return {
    changed() {
      if (!closed) timer ??= setTimeout(write, SAVE_DELAY_MS);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        write();
      }
      await writing.idle();
    },
    async close() {
      clearTimeout(timer);
      write();
      closed = true;
      await writing.idle();
    },
  };
}

/** A process that runs a goal, or would: its session's pid, and where it is asked to let the goal go. */
export interface Runner {
  session: number;
  address: string;
}

/**
 * Who has a goal: the process that runs it, the session that started that
 * process, and where it is asked to let the goal go.
 */
export interface Holder extends Runner {
  pid: number;
}

/** What a holder stopped as it let a goal go, for the session taking it up to resume: its meetings under way. */
export interface HandedOver {
  meetings: string[];
}

/** A lock file's text; undefined when there is none. */
function lockText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/** The holder a lock file names; undefined when there is none or it can't be read. */
function readHolder(file: string): Holder | undefined {
  const text = lockText(file);
  try {
    return text === undefined ? undefined : (JSON.parse(text) as Holder);
  } catch {
    return undefined;
  }
}

/** Who holds a lock, while they run; undefined when nobody does. */
export function holderOf(lock: string): Holder | undefined {
  const holder = readHolder(lock);
  return holder && running(holder.pid) ? holder : undefined;
}

/** This process as the holder, in a file of its own beside the lock, to be put in place whole. */
async function holding(lock: string, me: Runner): Promise<string> {
  await mkdir(path.dirname(lock), { recursive: true });
  const file = `${lock}.${String(process.pid)}`;
  const holder: Holder = { pid: process.pid, ...me };
  await writeFile(file, JSON.stringify(holder));
  return file;
}

/** How long a taker waits for another that is replacing an ended holder's lock. */
const REPLACING_WAIT_MS = 10;

/**
 * Takes a goal for this process as `me`. A holder that runs is asked to let
 * it go (`takeOver`), and what it stopped is given back. A lock is put in
 * place whole or not at all, so of several sessions starting at once one
 * takes it. A lock whose holder has ended is replaced by one taker only: the
 * one that claims that ending, which replaces the lock only if it is still
 * the ended holder's, so a lock taken meanwhile is never replaced.
 */
export async function takeGoal(
  lock: string,
  me: Runner,
  takeOver: (holder: Holder) => Promise<HandedOver>,
): Promise<HandedOver> {
  const mine = await holding(lock, me);
  // What every holder asked stopped: another taker may get in between.
  const handed: HandedOver = { meetings: [] };
  try {
    for (;;) {
      try {
        await link(mine, lock);
        return handed;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
      const ended = lockText(lock);
      // Let go of meanwhile: try again.
      if (ended === undefined) continue;
      const holder = readHolder(lock);
      if (holder && running(holder.pid)) {
        if (holder.pid === process.pid) {
          await renameOver(mine, lock);
          return handed;
        }
        const stopped = await takeOver(holder);
        handed.meetings.push(...stopped.meetings);
        continue;
      }
      const claim = `${lock}.ended-${String(holder?.pid ?? "unread")}`;
      try {
        await link(mine, claim);
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        // Done with meanwhile: try again. Still there, its taker either replaces the lock or ended partway.
        if (lockText(claim) === undefined) continue;
        const replacing = readHolder(claim);
        if (!replacing || !running(replacing.pid))
          throw new Error(`A session taking this goal ended partway: delete ${lock} and ${claim}`, {
            cause: error,
          });
        await delay(REPLACING_WAIT_MS);
        continue;
      }
      try {
        if (lockText(lock) === ended) {
          await renameOver(mine, lock);
          return handed;
        }
      } finally {
        await rm(claim, { force: true });
      }
    }
  } finally {
    await rm(mine, { force: true });
  }
}

/** Lets the goal go, as this process ends: at once, since it may be exiting. */
export function releaseGoal(lock: string) {
  if (holderOf(lock)?.pid === process.pid) unlinkSync(lock);
}

/**
 * Makes a new goal's folder in a repository's folder (`repoFolder`), named by
 * a slug from `name` that no goal has (`taken`, and every folder there): of
 * goals starting at once, each makes a folder of its own.
 */
export async function newGoalFolder(
  repoFolder: string,
  name: string,
  taken: Set<string>,
): Promise<{ slug: string; folder: string }> {
  const goals = goalsFolder(repoFolder);
  await mkdir(goals, { recursive: true });
  for (const slug of await readdir(goals)) taken.add(slug);
  for (;;) {
    const slug = slugFor(name, taken);
    const folder = path.join(goals, slug);
    try {
      await mkdir(folder);
      return { slug, folder };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      taken.add(slug);
    }
  }
}

/** A goal of a repository as its folder has it: its slug, its state, and who runs it, if anyone. */
/** One of a repository's goals: its state, or why this openplan can't read it. */
export type GoalEntry = { slug: string; holder?: Holder } & (
  { state: GoalState } | { unreadable: string }
);

/** When a goal was started; one that can't be read comes after the rest. */
const startedAt = (entry: GoalEntry) =>
  "state" in entry ? entry.state.goal.createdAt : Number.POSITIVE_INFINITY;

/**
 * A repository's goals, oldest first, from their folders (`repoFolder`). A
 * folder with no state yet is a goal starting: it isn't one yet. A goal that
 * can't be read is listed with why, so the rest are listed all the same.
 */
export async function listGoals(repoFolder: string): Promise<GoalEntry[]> {
  const folder = goalsFolder(repoFolder);
  let slugs: string[];
  try {
    slugs = await readdir(folder);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  const found = await Promise.all(
    slugs.map(async (slug): Promise<GoalEntry | undefined> => {
      const files = goalFiles(path.join(folder, slug));
      const holder = holderOf(files.lock);
      const held = holder && { holder };
      try {
        return { slug, state: await readState(files.state), ...held };
      } catch (error) {
        if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return undefined;
        return { slug, unreadable: errorText(error), ...held };
      }
    }),
  );
  return found.filter((entry) => entry !== undefined).sort((a, b) => startedAt(a) - startedAt(b));
}

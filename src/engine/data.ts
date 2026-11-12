/**
 * What openplan keeps in its data folder for a repository (docs/design.md
 * §3.2, §3.4): the team's state, the lock that gives the team to one session,
 * and where everything else in that folder goes.
 */
import { createHash } from "node:crypto";
import { link, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { errorText } from "./core.ts";
import { writeWhole } from "./files.ts";
import type { Repository } from "./git.ts";
import { running } from "./running.ts";
import type { TeamState } from "./types.ts";

/**
 * A repository's folder in the data folder: its name, and a hash of its git
 * folder, which its own worktrees share, so they all have the one team.
 */
export function repoFolder(dataFolder: string, repo: Repository): string {
  const name = path.basename(repo.top).replace(/[^\w.-]+/g, "-");
  const hash = createHash("sha256").update(repo.common).digest("hex").slice(0, 12);
  return path.join(dataFolder, "repos", `${name}-${hash}`);
}

/** The files in a repository's folder. */
export const dataFiles = (folder: string) => ({
  state: path.join(folder, "state.json"),
  lock: path.join(folder, "lock"),
  members: path.join(folder, "members.json"),
  /** A member's settings file (policy.ts writeSettings). */
  settings: (member: string) => path.join(folder, "settings", `${member}.json`),
});

/** The version of `state.json` this openplan writes. */
const STATE_VERSION = 1;

/** How long after a change the state is written: a burst of changes is written once. */
const SAVE_DELAY_MS = 200;

/**
 * The team's state from its file: an empty one when there is none yet.
 * Throws when the file can't be read as this openplan's.
 */
export async function readState(file: string): Promise<TeamState> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { goals: [], tasks: [], subtasks: [], meetings: [], questions: [] };
  }
  let saved: { version: number; state: TeamState };
  try {
    saved = JSON.parse(text) as typeof saved;
  } catch (error) {
    throw new Error(`${file} can't be read (${errorText(error)}): move it away to start over`, {
      cause: error,
    });
  }
  if (saved.version > STATE_VERSION)
    throw new Error(`${file} was written by a newer openplan: update openplan to go on`);
  return saved.state;
}

/** Writes the state a moment after it changes (`changed`), and at once on `flush`. */
export interface StateWriter {
  changed(): void;
  flush(): Promise<void>;
}

/**
 * Writes `state` to `file` whole, in one go: a new file renamed over the
 * old, so a crash leaves the last one written. `failed`: a write didn't go.
 */
export function stateWriter(
  file: string,
  state: () => TeamState,
  failed: (error: unknown) => void,
): StateWriter {
  let timer: NodeJS.Timeout | undefined;
  let writing = Promise.resolve();
  const write = () => {
    timer = undefined;
    writing = writing
      .then(() => writeWhole(file, JSON.stringify({ version: STATE_VERSION, state: state() })))
      .catch(failed);
  };
  return {
    changed() {
      timer ??= setTimeout(write, SAVE_DELAY_MS);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        write();
      }
      await writing;
    },
  };
}

/**
 * Who has a repository's team: the process that runs it, the session that
 * started that process, and whether it has opened the team yet (`Engine.open`).
 */
export interface Holder {
  pid: number;
  session: number;
  open: boolean;
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

const busy = (lock: string, holder: Holder) =>
  new Error(
    `Another Claude Code session runs this repository's team (pid ${String(holder.session)}). If it has ended, delete ${lock}`,
  );

/** This process as the holder, in a file of its own beside the lock, to be put in place whole. */
async function holding(lock: string, session: number, open: boolean): Promise<string> {
  await mkdir(path.dirname(lock), { recursive: true });
  const file = `${lock}.${String(process.pid)}`;
  const holder: Holder = { pid: process.pid, session, open };
  await writeFile(file, JSON.stringify(holder));
  return file;
}

const code = (error: unknown) => (error as NodeJS.ErrnoException).code;

/** How long a taker waits for another that is replacing an ended holder's lock. */
const REPLACING_WAIT_MS = 10;

/**
 * Takes a repository's team for this process and `session` (its pid), or
 * throws which session holds it. A lock is put in place whole or not at all,
 * so of several sessions starting at once one takes it. A lock whose holder
 * has ended is replaced by one taker only: the one that claims that ending,
 * which replaces the lock only if it is still the ended holder's, so a lock
 * taken meanwhile is never replaced.
 */
export async function takeTeam(lock: string, session: number): Promise<void> {
  const mine = await holding(lock, session, false);
  try {
    for (;;) {
      try {
        await link(mine, lock);
        return;
      } catch (error) {
        if (code(error) !== "EEXIST") throw error;
      }
      const ended = lockText(lock);
      // Let go of meanwhile: try again.
      if (ended === undefined) continue;
      const holder = readHolder(lock);
      if (holder && running(holder.pid)) {
        if (holder.pid !== process.pid) throw busy(lock, holder);
        await rename(mine, lock);
        return;
      }
      const claim = `${lock}.ended-${String(holder?.pid ?? "unread")}`;
      try {
        await link(mine, claim);
      } catch (error) {
        if (code(error) !== "EEXIST") throw error;
        // Done with meanwhile: try again. Still there, its taker either replaces the lock or ended partway.
        if (lockText(claim) === undefined) continue;
        const replacing = readHolder(claim);
        if (!replacing || !running(replacing.pid))
          throw new Error(
            `A session taking this repository's team ended partway: delete ${lock} and ${claim}`,
            { cause: error },
          );
        await delay(REPLACING_WAIT_MS);
        continue;
      }
      try {
        if (lockText(lock) === ended) {
          await rename(mine, lock);
          return;
        }
      } finally {
        await rm(claim, { force: true });
      }
    }
  } finally {
    await rm(mine, { force: true });
  }
}

/** Tells the lock that this process has opened the team: its state is the team's as it goes on. */
export async function openedTeam(lock: string, session: number): Promise<void> {
  await rename(await holding(lock, session, true), lock);
}

/** Lets the team go, as this process ends: at once, since it may be exiting. */
export function releaseTeam(lock: string) {
  if (holderOf(lock)?.pid === process.pid) unlinkSync(lock);
}

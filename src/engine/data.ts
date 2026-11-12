/**
 * What openplan keeps in its data folder for a repository (docs/design.md
 * §3.2, §3.4): the team's state, the lock that gives the team to one session,
 * and where everything else in that folder goes.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { errorText } from "./core.ts";
import type { Repository } from "./git.ts";
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
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        const fresh = `${file}.new`;
        await writeFile(fresh, JSON.stringify({ version: STATE_VERSION, state: state() }));
        await rename(fresh, file);
      })
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

/** Whether a process is running. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // There, but not ours to signal.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
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

/** Who holds a lock, while they run; undefined when nobody does. */
export function holderOf(lock: string): Holder | undefined {
  let holder: Holder;
  try {
    holder = JSON.parse(readFileSync(lock, "utf8")) as Holder;
  } catch {
    return undefined;
  }
  return running(holder.pid) ? holder : undefined;
}

const hold = async (lock: string, open: boolean) => {
  await mkdir(path.dirname(lock), { recursive: true });
  const holder: Holder = { pid: process.pid, session: process.ppid, open };
  await writeFile(lock, JSON.stringify(holder));
};

/**
 * Takes a repository's team for this process and the session that started
 * it, or throws which session holds it. One that has ended holds nothing.
 */
export async function takeTeam(lock: string): Promise<void> {
  const holder = holderOf(lock);
  if (holder && holder.pid !== process.pid)
    throw new Error(
      `Another Claude Code session runs this repository's team (pid ${String(holder.session)}). If it has ended, delete ${lock}`,
    );
  await hold(lock, false);
}

/** Tells the lock that this process has opened the team: its state is the team's as it goes on. */
export const openedTeam = (lock: string) => hold(lock, true);

/** Lets the team go, as this process ends: at once, since it may be exiting. */
export function releaseTeam(lock: string) {
  if (holderOf(lock)?.pid === process.pid) unlinkSync(lock);
}

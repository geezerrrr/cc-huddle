/**
 * The lock that gives a goal to one session (docs/design.md §3.2): who holds
 * it, taking it whole or not at all, taking it over from a holder that runs
 * or has ended, and letting it go.
 */
import { link, rm } from "node:fs/promises";
import { unlinkSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { errorCode } from "../shared/errors.ts";
import { renameOver, textIfThere, writeWhole } from "../shared/files.ts";
import { lockFiles } from "../shared/layout.ts";
import { running } from "../shared/running.ts";

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

/** The holder a lock file names; undefined when there is none or it can't be read. */
function readHolder(file: string): Holder | undefined {
  const text = textIfThere(file);
  try {
    return text === undefined ? undefined : (JSON.parse(text) as Holder);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/** Who holds a lock, while they run; undefined when nobody does. */
export function holderOf(lock: string): Holder | undefined {
  const holder = readHolder(lock);
  return holder && running(holder.pid) ? holder : undefined;
}

/** This process as the holder, in a file of its own beside the lock, to be put in place whole. */
async function holding(lock: string, me: Runner): Promise<string> {
  const file = lockFiles(lock).mine(process.pid);
  const holder: Holder = { pid: process.pid, ...me };
  await writeWhole(file, JSON.stringify(holder));
  return file;
}

/** How long a taker waits for another that is replacing an ended holder's lock. */
const REPLACING_WAIT_MS = 10;

/**
 * Takes a lock for this process as `me`. A holder that runs is asked to let
 * it go (`takeOver`), and what each holder asked gave is given back; one
 * that doesn't answer (undefined) has ended, its pid another process's
 * since. A lock is put in place whole or not at all, so of several sessions
 * starting at once one takes it. A lock whose holder has ended is replaced by one taker only: the
 * one that claims that ending, which replaces the lock only if it is still
 * the ended holder's, so a lock taken meanwhile is never replaced.
 */
export async function takeLock<T>(
  lock: string,
  me: Runner,
  takeOver: (holder: Holder) => Promise<T | undefined>,
): Promise<T[]> {
  const mine = await holding(lock, me);
  // What every holder asked gave: another taker may get in between.
  const handed: T[] = [];
  try {
    for (;;) {
      try {
        await link(mine, lock);
        return handed;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
      const ended = textIfThere(lock);
      // Let go of meanwhile: try again.
      if (ended === undefined) continue;
      const holder = readHolder(lock);
      if (holder && running(holder.pid)) {
        if (holder.pid === process.pid) {
          await renameOver(mine, lock);
          return handed;
        }
        const given = await takeOver(holder);
        if (given !== undefined) {
          handed.push(given);
          continue;
        }
        // Nothing answers where it is asked: its server ended, and its pid is another process's since.
      }
      const claim = lockFiles(lock).claim(String(holder?.pid ?? "unread"));
      try {
        await link(mine, claim);
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        // Done with meanwhile: try again. Still there, its taker either replaces the lock or ended partway.
        if (textIfThere(claim) === undefined) continue;
        const replacing = readHolder(claim);
        if (!replacing || !running(replacing.pid))
          throw new Error(`A session taking this goal ended partway: delete ${lock} and ${claim}`, {
            cause: error,
          });
        await delay(REPLACING_WAIT_MS);
        continue;
      }
      try {
        if (textIfThere(lock) === ended) {
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

/** Lets the lock go, as this process ends: at once, since it may be exiting. */
export function releaseLock(lock: string) {
  if (holderOf(lock)?.pid === process.pid) unlinkSync(lock);
}

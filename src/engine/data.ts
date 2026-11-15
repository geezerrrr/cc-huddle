/**
 * A repository's goals in the data folder (docs/design.md §3.4): each goal's
 * state, read and written as this openplan's version has it, a new goal's
 * folder, and the goals listed with who holds each.
 */
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { errorCode, errorText } from "../shared/errors.ts";
import { writeWhole, namesIfThere } from "../shared/files.ts";
import { goalFiles, goalsFolder, goalFolder } from "../shared/layout.ts";
import { inOrder } from "../shared/serial.ts";
import { slugFor } from "./git.ts";
import type { GoalState } from "./types.ts";
import { holderOf, type Holder } from "./lock.ts";

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
    const folder = goalFolder(repoFolder, slug);
    try {
      await mkdir(folder);
      return { slug, folder };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      taken.add(slug);
    }
  }
}

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
  const slugs = await namesIfThere(folder);
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

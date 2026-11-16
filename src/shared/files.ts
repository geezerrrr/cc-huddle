/**
 * Files as all of cc-huddle reads and writes them: read when they are there,
 * and written whole (a new file beside, renamed over it), so a reader or a
 * crash never finds one half written. A leaf, for the bootstrap too.
 */
import { readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { errorCode } from "./errors.ts";

/** What `reading` gives, or `missing` when the file it reads isn't there; anything else is thrown. */
export async function ifThere<T, M>(reading: Promise<T>, missing: M): Promise<T | M> {
  try {
    return await reading;
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return missing;
    throw error;
  }
}

/** Whether `file` is there; anything but its absence is thrown. */
export const exists = (file: string) =>
  ifThere(
    stat(file).then(() => true),
    false,
  );

/** A file's text; undefined when it isn't there, anything else thrown. */
export function textIfThere(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * A JSON file's contents; undefined when it isn't there. Text that isn't JSON
 * is a SyntaxError naming the file.
 */
export async function jsonIfThere(file: string): Promise<unknown> {
  const text = await ifThere(readFile(file, "utf8"), undefined);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SyntaxError(`${file}: ${(error as SyntaxError).message}`, { cause: error });
  }
}

/** The names in a folder; none when it isn't there. */
export const namesIfThere = (folder: string) => ifThere(readdir(folder), []);

/** What Windows answers a rename while another program (an antivirus, an indexer) holds the file or folder a moment. */
const HELD = new Set(["EPERM", "EACCES", "EBUSY"]);
/** How long a rename on Windows keeps trying while something holds what it moves. */
const HELD_WAIT_MS = 5000;

/**
 * Renames `from` to `to`, over a file there; on Windows again, a while, as
 * long as another program holds either, as npm does.
 */
export async function renameOver(from: string, to: string): Promise<void> {
  const until = Date.now() + HELD_WAIT_MS;
  for (let wait = 10; ; wait = Math.min(wait * 2, 500)) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const held = process.platform === "win32" && HELD.has(errorCode(error) ?? "");
      if (!held || Date.now() > until) throw error;
      await delay(wait);
    }
  }
}

/** How many files this process has written whole: each write has a new file of its own beside. */
let writes = 0;
const fresh = (file: string) => `${file}.${String(process.pid)}.${String((writes += 1))}.new`;

/** Writes `text` to `file` whole, its folder made if need be; `mode` for a file only you may read. */
export async function writeWhole(file: string, text: string, mode?: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const beside = fresh(file);
  await writeFile(beside, text, { mode });
  await renameOver(beside, file);
}

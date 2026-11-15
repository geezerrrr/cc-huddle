/**
 * Writing a file whole: a new file beside it, renamed over it, so a reader
 * or a crash never finds it half written. Renaming over, as all of openplan
 * does it.
 */
import { renameSync, writeFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { errorCode } from "./core.ts";

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

const fresh = (file: string) => `${file}.${String(process.pid)}.new`;

/** Writes `text` to `file` whole, its folder made if need be; `mode` for a file only you may read. */
export async function writeWhole(file: string, text: string, mode?: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(fresh(file), text, { mode });
  await renameOver(fresh(file), file);
}

/** writeWhole, at once: for a process that may be exiting. */
export function writeWholeSync(file: string, text: string): void {
  writeFileSync(fresh(file), text);
  renameSync(fresh(file), file);
}

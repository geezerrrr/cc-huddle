/**
 * Writing a file whole: a new file beside it, renamed over it, so a reader
 * or a crash never finds it half written.
 */
import { renameSync, writeFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const fresh = (file: string) => `${file}.${String(process.pid)}.new`;

/** Writes `text` to `file` whole, its folder made if need be; `mode` for a file only you may read. */
export async function writeWhole(file: string, text: string, mode?: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(fresh(file), text, { mode });
  await rename(fresh(file), file);
}

/** writeWhole, at once: for a process that may be exiting. */
export function writeWholeSync(file: string, text: string): void {
  writeFileSync(fresh(file), text);
  renameSync(fresh(file), file);
}

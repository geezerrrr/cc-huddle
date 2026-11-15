/**
 * Your session's permission mode, kept for its members (docs/design.md §3.3,
 * §8): the permission mode hook writes it as Claude Code gives it, under the
 * session's pid, and that session's MCP server reads it for each member's
 * working turn. Plan mode is how your session plans its own work, not a
 * permission level: while it plans, members keep the mode they had.
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { textIfThere, writeWhole } from "../shared/files.ts";
import { running } from "../shared/running.ts";
import { sessionsFolder } from "../shared/layout.ts";

/** The modes a member works in, as the hooks name them. */
const MODES: readonly PermissionMode[] = [
  "default",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
];

const fileOf = (dataFolder: string, session: number) =>
  path.join(sessionsFolder(dataFolder), `${String(session)}.mode`);

/**
 * Keeps `mode` for session `session` (its pid), as a hook got it; plan mode
 * and any other that isn't a permission level leave the kept one. Files of
 * sessions that have ended go.
 */
export async function keepMode(dataFolder: string, session: number, mode: string) {
  if (!MODES.includes(mode as PermissionMode)) return;
  await writeWhole(fileOf(dataFolder, session), mode);
  for (const name of await readdir(sessionsFolder(dataFolder))) {
    const { name: pid, ext } = path.parse(name);
    if (ext === ".mode" && !running(Number(pid)))
      await rm(path.join(sessionsFolder(dataFolder), name), { force: true });
  }
}

/** Session `session`'s mode as last kept; undefined before any. */
export function modeOf(dataFolder: string, session: number): PermissionMode | undefined {
  return textIfThere(fileOf(dataFolder, session)) as PermissionMode | undefined;
}

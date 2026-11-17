/**
 * Where cc-huddle keeps things in its data folder (docs/design.md §3.4),
 * named here: each repository's goals, each goal's files, and the folders of
 * the session modes and the server's dependencies. A leaf, for the bootstrap too.
 */
import { createHash } from "node:crypto";
import path from "node:path";

/**
 * A repository's folder: its name, and a hash of its git folder (`common`),
 * which its own worktrees share, so they all have the same goals.
 */
export function repoFolder(dataFolder: string, repo: { top: string; common: string }): string {
  const name = path.basename(repo.top).replace(/[^\w.-]+/g, "-");
  const hash = createHash("sha256").update(repo.common).digest("hex").slice(0, 12);
  return path.join(dataFolder, "repos", `${name}-${hash}`);
}

/** The folder of a repository's goals, each in a folder named by its slug. */
export const goalsFolder = (repoFolder: string) => path.join(repoFolder, "goals");

/** A goal's folder, by its slug. */
export const goalFolder = (repoFolder: string, slug: string) =>
  path.join(goalsFolder(repoFolder), slug);

/** The settings file a repository's recommending session runs under (recommend.ts). */
export const recommendSettings = (repoFolder: string) =>
  path.join(repoFolder, "recommend.settings.json");

/** Where each session's permission mode is kept, by its pid (session-mode.ts). */
export const sessionsFolder = (dataFolder: string) => path.join(dataFolder, "sessions");

/** Where the MCP server's npm dependencies are installed, by version (bootstrap.ts). */
export const depsFolder = (dataFolder: string) => path.join(dataFolder, "deps");

/** The files and folders in a goal's folder. */
export const goalFiles = (folder: string) => ({
  state: path.join(folder, "state.json"),
  lock: path.join(folder, "lock"),
  members: path.join(folder, "members.json"),
  /** The goal's copy of the team (team.ts copyTeam). */
  team: path.join(folder, "team.json"),
  /** A member's settings file (policy.ts writeSettings). */
  settings: (member: string) => path.join(folder, "settings", `${member}.json`),
  /** The worktree the goal's branch is checked out in. */
  checkout: path.join(folder, "checkout"),
  /** The worktree a subtask works in. */
  desk: (subtaskId: string) => path.join(folder, "desks", subtaskId),
  /** What a subtask's runs did (records.ts). */
  record: (subtaskId: string) => path.join(folder, "records", `${subtaskId}.jsonl`),
  /** An approved plan's document. */
  plan: (meetingId: string) => path.join(folder, "plans", `${meetingId}.md`),
});

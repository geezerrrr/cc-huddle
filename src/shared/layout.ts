/**
 * Where openplan keeps things in its data folder (docs/design.md §3.4),
 * named here only: each repository's goals, each goal's files, the session
 * modes and the server's dependencies. A leaf, for the bootstrap too.
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

/** Where each session's permission mode is kept, by its pid (session-mode.ts). */
export function sessionModes(dataFolder: string) {
  const folder = path.join(dataFolder, "sessions");
  return {
    folder,
    file: (pid: number) => path.join(folder, `${String(pid)}.mode`),
    /** The session a file in the folder is kept for; undefined for a file that isn't a mode. */
    pidOf: (name: string) => {
      const { name: pid, ext } = path.parse(name);
      return ext === ".mode" ? Number(pid) : undefined;
    },
  };
}

/** Where the MCP server's npm dependencies are installed, by version (bootstrap.ts). */
export function depsFolders(dataFolder: string) {
  const folder = path.join(dataFolder, "deps");
  return {
    folder,
    /** A version's dependencies, by the hash of what it locks. */
    version: (hash: string) => path.join(folder, hash.slice(0, 12)),
    /** Where process `pid` installs a version, beside it, before it moves in whole. */
    draft: (version: string, pid: number) => `${version}.${String(pid)}`,
    /** The process installing in a folder there; undefined for a version's own folder. */
    pidOf: (name: string) => {
      const [, pid] = name.split(".");
      return pid === undefined ? undefined : Number(pid);
    },
  };
}

/** The files a lock is taken through, beside it (lock.ts): a taker's own, by its pid, and the claim on an ended holder's. */
export const lockFiles = (lock: string) => ({
  mine: (pid: number) => `${lock}.${String(pid)}`,
  claim: (holder: string) => `${lock}.ended-${holder}`,
});

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

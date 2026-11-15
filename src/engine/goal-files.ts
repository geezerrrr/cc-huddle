/**
 * Where everything of a goal is, in its folder in the data folder (docs/design.md
 * §3.4), named here only.
 */
import path from "node:path";

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

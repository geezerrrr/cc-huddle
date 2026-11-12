/**
 * What the SessionStart hook tells your session (docs/design.md §3.3): where
 * the repository's team stands, read from its files, as context. A
 * repository with no team, or a team with no goals yet, adds nothing.
 */
import { dataFiles, holderOf, readState, repoFolder } from "../engine/data.ts";
import { openRepository } from "../engine/git.ts";
import { loadTeam, teamFolder } from "../engine/team.ts";
import { statusText } from "./status.ts";

/** The context for session `session` (its pid) in `cwd`, with your own team's folder `userTeam`. */
export async function sessionContext(
  cwd: string,
  dataFolder: string,
  userTeam: string,
  session: number,
): Promise<string | undefined> {
  let repo;
  let team;
  try {
    repo = await openRepository(cwd);
    ({ team } = await loadTeam([userTeam, teamFolder(repo.top)]));
  } catch {
    // No repository, or no team in it: openplan has nothing to say here.
    return undefined;
  }
  const files = dataFiles(repoFolder(dataFolder, repo));
  const state = await readState(files.state);
  if (!state.goals.length) return undefined;
  const status = statusText({ ...state, members: team.members.map((m) => m.name) });
  const holder = holderOf(files.lock);
  if (holder && holder.session !== session)
    return `openplan's team on this repository runs in another Claude Code session (pid ${String(holder.session)}); this one can't run it while that one does. As it stands:\n\n${status}`;
  const context = `openplan's team on this repository, as it stands:\n\n${status}`;
  // Active goals the team isn't open on yet: a session ended without closing it (§3.2).
  return !holder?.open && state.goals.some((g) => g.status === "active")
    ? `${context}\n\nThe session before ended without closing the team. This session pauses what it left going as it opens the team; nothing goes on until a goal is resumed.`
    : context;
}

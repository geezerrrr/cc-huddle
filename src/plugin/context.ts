/**
 * What the SessionStart hook tells your session (docs/design.md §3.3): where
 * the repository's team stands, read from its files, as context. A
 * repository with no team, or a team with no goals yet, adds nothing.
 */
import { readState, dataFiles, repoFolder } from "../engine/data.ts";
import { openRepository } from "../engine/git.ts";
import { loadTeam } from "../engine/team.ts";
import { statusText } from "./status.ts";

export async function sessionContext(cwd: string, dataFolder: string): Promise<string | undefined> {
  let repo;
  let team;
  try {
    repo = await openRepository(cwd);
    ({ team } = await loadTeam(repo.top));
  } catch {
    // No repository, or no team in it: openplan has nothing to say here.
    return undefined;
  }
  const state = await readState(dataFiles(repoFolder(dataFolder, repo)).state);
  if (!state.goals.length) return undefined;
  const work = { ...state, members: team.members.map((m) => m.name) };
  return `openplan's team on this repository, as it stands:\n\n${statusText(work)}`;
}

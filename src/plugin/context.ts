/**
 * What the SessionStart hook tells your session (docs/design.md §3.3): the
 * goal it runs, if it does (after `/clear`), and the repository's goals it
 * can take up, read from their folders, as context. A repository with no
 * goals adds nothing.
 */
import { GitError, RepositoryGoals } from "../engine/index.ts";
import { othersText, statusText } from "./status.ts";

/** The context for session `session` (its pid) in `cwd`. */
export async function sessionContext(
  cwd: string,
  dataFolder: string,
  session: number,
): Promise<string | undefined> {
  let repository;
  try {
    repository = await RepositoryGoals.of(dataFolder, cwd);
  } catch (error) {
    // No repository: openplan has nothing to say here.
    if (error instanceof GitError) return undefined;
    throw error;
  }
  const goals = await repository.list();
  const mine = goals.find((g) => g.holder?.session === session);
  const parts: string[] = [];
  // A goal this session runs was read as it was taken up.
  if (mine && "state" in mine) {
    // Read from the goal's files: what is under way is the server's, not known here.
    const status = statusText(await repository.stored(mine.slug, mine.state));
    parts.push(
      `This session runs openplan's goal "${mine.state.goal.name}", as it stands:\n\n${status}`,
    );
  }
  const others = othersText(goals.filter((g) => g !== mine));
  if (others) parts.push(`openplan: ${others}`);
  return parts.length ? parts.join("\n\n") : undefined;
}

/**
 * What the SessionStart hook tells your session (docs/design.md §3.3): the
 * goal it runs, if it does (after `/clear`), and the repository's goals it
 * can take up, read from their folders, as context. A repository with no
 * goals adds nothing.
 */
import path from "node:path";
import { goalFiles, goalsFolder, listGoals, repoFolder } from "../engine/data.ts";
import { openRepository } from "../engine/git.ts";
import { readCopy } from "../engine/team.ts";
import { othersText, statusText } from "./status.ts";

/** The context for session `session` (its pid) in `cwd`. */
export async function sessionContext(
  cwd: string,
  dataFolder: string,
  session: number,
): Promise<string | undefined> {
  let repo;
  try {
    repo = await openRepository(cwd);
  } catch {
    // No repository: openplan has nothing to say here.
    return undefined;
  }
  const root = repoFolder(dataFolder, repo);
  const goals = await listGoals(root);
  const mine = goals.find((g) => g.holder?.session === session);
  const parts: string[] = [];
  if (mine) {
    const { team } = await readCopy(goalFiles(path.join(goalsFolder(root), mine.slug)).team);
    const status = statusText({ ...mine.state, members: team.members.map((m) => m.name) });
    parts.push(
      `This session runs openplan's goal "${mine.state.goal.name}", as it stands:\n\n${status}`,
    );
  }
  const others = othersText(goals.filter((g) => g !== mine));
  if (others) parts.push(`openplan: ${others}`);
  return parts.length ? parts.join("\n\n") : undefined;
}

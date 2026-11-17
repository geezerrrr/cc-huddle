/**
 * A repository's goals as cc-huddle keeps them (docs/design.md §3.4): the
 * repository a folder is in, found once, and its goals in the data folder,
 * listed, and read as their files left them.
 */
import { goalFiles, goalFolder, repoFolder } from "../shared/layout.ts";
import { workOf, type Team } from "./core.ts";
import { listGoals, type GoalEntry } from "./data.ts";
import type { Work } from "./derive.ts";
import { openRepository, type Repository } from "./git.ts";
import { loadTeam, readCopy } from "./team.ts";
import type { GoalState } from "./types.ts";

export class RepositoryGoals {
  private constructor(
    readonly repo: Repository,
    /** The repository's folder in the data folder. */
    readonly folder: string,
  ) {}

  /** The goals of the repository `cwd` is in; throws a GitError when it is in none. */
  static async of(dataFolder: string, cwd: string): Promise<RepositoryGoals> {
    const repo = await openRepository(cwd);
    return new RepositoryGoals(repo, repoFolder(dataFolder, repo));
  }

  /** Its goals, oldest first (listGoals). */
  list(): Promise<GoalEntry[]> {
    return listGoals(this.folder);
  }

  /** A goal's folder, and the files in it, by its slug. */
  goal(slug: string) {
    const folder = goalFolder(this.folder, slug);
    return { folder, files: goalFiles(folder) };
  }

  /** The team a goal started now would have: yours, with the repository's own (team.ts loadTeam). */
  async team(userTeam: string): Promise<Team> {
    return (await loadTeam(userTeam, this.repo.top)).team;
  }

  /** A goal as its files left it, with nothing under way: as a session that doesn't run it reads it. */
  async stored(slug: string, state: GoalState): Promise<Work> {
    const { folder, files } = this.goal(slug);
    const { team } = await readCopy(files.team);
    return workOf({
      state,
      team,
      places: { repo: this.repo, slug, root: folder },
      underWay: () => [],
      meetingsNow: () => ({}),
      questionsNow: () => [],
      handingBack: () => undefined,
    });
  }
}

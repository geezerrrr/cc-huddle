/**
 * The goal your session runs (docs/design.md §3.2): none until it starts one
 * or takes one up, and one at a time. Taking up a goal another session runs
 * asks that session to let it go; this one lets its own go the same way.
 * Each change to which goal it runs waits for the one before.
 */
import {
  Engine,
  type EngineOptions,
  type GoalEntry,
  type HandedOver,
  RepositoryGoals,
} from "../engine/index.ts";
import { serialBy } from "../shared/serial.ts";
import { noGoalForModel } from "./words.ts";

/** The key the session's changes of goal take turns on. */
const TURN = "goal";

export class Session {
  private engine: Engine | undefined;
  /** The session's repository's goals, once found. */
  private repo: Promise<RepositoryGoals> | undefined;
  /** The goal that moved to another session, by name, until this one runs another. */
  private movedAway: string | undefined;
  private openedCount = 0;
  private readonly turn = serialBy();

  /**
   * `options`: what an engine runs with, and `claude`, the Claude Code its
   * members run, found as a goal first opens. `changed`: the session's goal
   * is another now, or it has none.
   */
  constructor(
    private readonly options: Omit<EngineOptions, "claude">,
    private readonly claude: () => Promise<string>,
    private readonly changed: (engine: Engine | undefined) => void,
  ) {}

  /** The session's goal, while it runs one. */
  get current(): Engine | undefined {
    return this.engine;
  }

  /** The session's goal; throws why there is none, and what to do, when it runs none. */
  get goal(): Engine {
    if (this.engine) return this.engine;
    throw new Error(this.none);
  }

  /** The goal that moved to another session, by name, until this one runs another. */
  get moved(): string | undefined {
    return this.movedAway;
  }

  /** How many goals the session has started or taken up: each one opened here counts. */
  get opened(): number {
    return this.openedCount;
  }

  /** Why the session runs no goal, and what to do. */
  get none(): string {
    return noGoalForModel(this.movedAway);
  }

  /** Starts a goal here: refused while this session's goal is active; a paused or archived one is let go. */
  start(name: string): Promise<Engine> {
    return this.turn(TURN, async () => {
      await this.leave();
      return this.run(await Engine.start(await this.engineOptions(), name));
    });
  }

  /**
   * Takes up the repository's goal `slug` and resumes it: this session's own
   * goal goes on; another, while this session's goal is active, is refused.
   */
  takeUp(slug: string): Promise<Engine> {
    return this.turn(TURN, async () => {
      if (this.engine?.work.goal.slug === slug) {
        await this.engine.goals.resume();
        return this.engine;
      }
      await this.leave();
      return this.run(await Engine.takeUp(await this.engineOptions(), slug));
    });
  }

  /** Lets the goal `slug` go to another session taking it up: what it stopped, nothing when it isn't this session's. */
  letGo(slug: string): Promise<HandedOver> {
    return this.turn(TURN, async () => {
      const was = this.engine;
      if (was?.work.goal.slug !== slug) return { meetings: [] };
      this.engine = undefined;
      this.movedAway = was.work.goal.name;
      this.changed(undefined);
      return was.close();
    });
  }

  /** Deletes this session's goal, archived, for good (Engine.delete). */
  delete(): Promise<void> {
    return this.turn(TURN, async () => {
      await this.goal.delete();
      this.engine = undefined;
      this.changed(undefined);
    });
  }

  /** Closes the session's goal as the session ends (Engine.close). */
  close(): Promise<void> {
    return this.turn(TURN, async () => {
      await this.engine?.close();
      this.engine = undefined;
    });
  }

  /** The repository's goals, oldest first. */
  async goals(): Promise<GoalEntry[]> {
    this.repo ??= RepositoryGoals.of(this.options.dataFolder, this.options.cwd).catch(
      (error: unknown) => {
        // Looked for again next time: the folder may be a repository by then.
        this.repo = undefined;
        throw error;
      },
    );
    return (await this.repo).list();
  }

  /** Of the repository's goals (`goals`), those this session doesn't run. */
  othersOf(goals: readonly GoalEntry[]): GoalEntry[] {
    const mine = this.engine?.work.goal.slug;
    return goals.filter((entry) => entry.slug !== mine);
  }

  /** The repository's goals this session doesn't run, oldest first. */
  async others(): Promise<GoalEntry[]> {
    return this.othersOf(await this.goals());
  }

  /** Lets go of this session's goal before it runs another: refused while it is active. */
  private async leave() {
    const was = this.engine;
    if (!was) return;
    const { goal } = was.work;
    if (goal.status === "active")
      throw new Error(
        `This session's goal "${goal.name}" is under way, and a session runs one goal: ask the user whether to pause it first (goal_action pause), or to run the other in another session`,
      );
    this.engine = undefined;
    this.changed(undefined);
    await was.close();
  }

  private async engineOptions(): Promise<EngineOptions> {
    return { ...this.options, claude: await this.claude() };
  }

  private run(engine: Engine): Engine {
    this.engine = engine;
    this.movedAway = undefined;
    this.openedCount++;
    this.changed(engine);
    return engine;
  }
}

/**
 * The goal your session runs (docs/design.md §3.2): none until it starts one
 * or takes one up, and one at a time. Taking up a goal another session runs
 * asks that session to let it go; this one lets its own go the same way.
 * Each change to which goal it runs waits for the one before.
 */
import {
  Engine,
  goalBranch,
  type EngineOptions,
  type GoalEntry,
  type GoalSettings,
  type HandedOver,
  RepositoryGoals,
  type Team,
} from "../engine/index.ts";
import { serialBy } from "../shared/serial.ts";
import { readDefaults, writeDefaults } from "./defaults.ts";

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

  /**
   * Starts a goal here, with the settings goals start with: refused while
   * this session's goal is active; a paused, archived or closed one is let
   * go, and a closed one is carried on from (§5).
   */
  start(name: string): Promise<Engine> {
    return this.turn(TURN, async () => {
      const last = this.engine?.work.goal;
      const after = last?.status === "closed" ? goalBranch(last.slug) : undefined;
      await this.leave();
      const settings = await readDefaults(this.options.dataFolder);
      return this.run(await Engine.start(await this.engineOptions(), name, settings, after));
    });
  }

  /** Switches how this session's goal works, if it runs one, and how goals started after do (§6.1): the settings as they are now. */
  async switchSettings(change: Partial<GoalSettings>): Promise<GoalSettings> {
    const now = { ...(await readDefaults(this.options.dataFolder)), ...change };
    await writeDefaults(this.options.dataFolder, now);
    this.engine?.switchSettings(change);
    return now;
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
    return (await this.repository()).list();
  }

  /** The team a goal started now would have; throws what is wrong with its files. */
  async team(): Promise<Team> {
    return (await this.repository()).team(this.options.userTeam);
  }

  /** Of the repository's goals (`goals`), those this session doesn't run and could take up: closed ones have nothing to go on with. */
  othersOf(goals: readonly GoalEntry[]): GoalEntry[] {
    const mine = this.engine?.work.goal.slug;
    return goals.filter(
      (entry) => entry.slug !== mine && !("state" in entry && entry.state.goal.status === "closed"),
    );
  }

  /** The repository's goals this session doesn't run, oldest first. */
  async others(): Promise<GoalEntry[]> {
    return this.othersOf(await this.goals());
  }

  /** Throws while this session's goal is active (§3.2): a session runs one goal, and another waits until it isn't. */
  free() {
    const goal = this.engine?.work.goal;
    if (goal?.status === "active")
      throw new Error(
        `This session's goal "${goal.name}" is under way, and a session runs one goal: pause it first (/huddle pause), or use another session.`,
      );
  }

  /** Lets go of this session's goal before it runs another: refused while it is active. */
  private async leave() {
    this.free();
    const was = this.engine;
    if (!was) return;
    this.engine = undefined;
    this.changed(undefined);
    await was.close();
  }

  private repository(): Promise<RepositoryGoals> {
    this.repo ??= RepositoryGoals.of(this.options.dataFolder, this.options.cwd).catch(
      (error: unknown) => {
        // Looked for again next time: the folder may be a repository by then.
        this.repo = undefined;
        throw error;
      },
    );
    return this.repo;
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

/** Why a session runs no goal, and what to do, as its model is told: `moved`, the goal that moved to another session. */
const noGoalForModel = (moved: string | undefined) =>
  moved
    ? `The goal "${moved}" moved to another Claude Code session. The user brings it back with /huddle resume.`
    : "This session runs no goal: start one (start_goal), or the user takes one up with /huddle resume.";

/**
 * The engine for one goal (docs/design.md §3): its state, its copy of the
 * team and its parts, put together. It knows nothing of the plugin: what it
 * is to run with, and where its failures go, come in its options.
 */
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { workOf, type Core, type Team } from "./core.ts";
import type { Work } from "./derive.ts";
import { newGoalFolder, readState, stateWriter, type StateWriter } from "./data.ts";
import { goalFiles } from "../shared/layout.ts";
import { currentBranch, openGoal, takenSlugs, type Places } from "./git.ts";
import { Goals } from "./goals.ts";
import { Meetings } from "./meetings.ts";
import { sessionOptions, teamSettings, writeSettings } from "./policy.ts";
import { recordMembersIn, stopRecording } from "./processes.ts";
import { systemPrompt, type SessionKind } from "./prompts.ts";
import { DOESNT_FIT, Questions, type Answer } from "./questions.ts";
import { Records } from "./records.ts";
import { Scheduler } from "./scheduler.ts";
import { serialBy } from "../shared/serial.ts";
import { allowInCopy, allowInTeam, copyTeam, loadTeam, readCopy, type TeamFiles } from "./team.ts";
import { onGoal, type GoalSettings, type GoalState, type Member } from "./types.ts";
import { releaseLock, takeLock, type Holder, type Runner } from "./lock.ts";
import { RepositoryGoals } from "./repository.ts";

/** The answers to the acceptance that is all the goal waits on which reach past it, to the goal (Goals.decide). */
const GOAL_OPTIONS: readonly string[] = ["acceptMerge", "acceptOnly"];

/** What a session stopped as it let its goal go, for the session taking it up to resume: its meetings under way. */
export interface HandedOver {
  meetings: string[];
}

export interface EngineOptions {
  /** A folder in the repository. */
  cwd: string;
  /** cc-huddle's data folder (`CLAUDE_PLUGIN_DATA`). */
  dataFolder: string;
  /** The Claude Code members run. */
  claude: string;
  /** The pid of the session the goal runs for, which the lock names. */
  session: number;
  /** Where this process is asked to let the goal go to another session, which the lock names too. */
  address: string;
  /** Asks the session that holds the goal `slug` to let it go, and gives what it stopped (§3.2). */
  takeOver: (holder: Holder, slug: string) => Promise<HandedOver | undefined>;
  /** Your session's permission mode as it is now, which members work in (§8); undefined before it is known. */
  sessionMode: () => PermissionMode | undefined;
  /** cc-huddle's ids as `enabledPlugins` names them, turned off in members' sessions. */
  plugins: readonly string[];
  /** Your own team's folder, under the repository's (team.ts userTeamFolder). */
  userTeam: string;
  /** The environment members' `${VAR}`s are filled in from. */
  env: Record<string, string | undefined>;
  /** Something went wrong that nobody waits on: the state or a record couldn't be written. */
  failed: (error: unknown) => void;
}

/** Where a goal's files are. */
type Files = ReturnType<typeof goalFiles>;

/** The engine's parts, each a module of its own. */
interface Parts {
  questions: Questions;
  scheduler: Scheduler;
  meetings: Meetings;
  goals: Goals;
  records: Records;
}

export class Engine {
  /** Your actions on the goal's subtasks, and work given directly. */
  readonly scheduler: Pick<Scheduler, "act" | "assignOne">;
  /** Calling meetings, and their plans in review. */
  readonly meetings: Pick<Meetings, "start" | "change" | "approve" | "cancel" | "resume">;
  /** Pausing, resuming and archiving the goal; deleting it is the engine's own (delete). */
  readonly goals: Pick<Goals, "pause" | "resume" | "archive">;
  /** What the subtasks' runs and the meeting turns did and do. */
  readonly records: Pick<Records, "read" | "speaking">;
  private readonly parts: Parts;

  private constructor(
    private readonly core: Core,
    records: Records,
    private readonly files: Files,
    private readonly writer: StateWriter,
    private readonly options: EngineOptions,
    private copy: TeamFiles,
  ) {
    const questions = new Questions(core);
    const scheduler = new Scheduler(core, questions);
    const meetings = new Meetings(core, scheduler);
    const goals = new Goals(core, scheduler, meetings, questions);
    this.parts = { questions, scheduler, meetings, goals, records };
    this.scheduler = scheduler;
    this.meetings = meetings;
    this.goals = goals;
    this.records = records;
  }

  /**
   * Starts a goal for this session: a folder of its own, the team copied
   * into it as its files have it now, its settings too (§6, §6.1), and its
   * branch cut from the branch your checkout is on, which it hands its work
   * back to (§5), checked out in its own worktree. Refused on a detached
   * HEAD: there is no branch to hand the work back to.
   */
  static async start(options: EngineOptions, name: string): Promise<Engine> {
    const goals = await RepositoryGoals.of(options.dataFolder, options.cwd);
    const { repo } = goals;
    const base = await currentBranch(options.cwd);
    if (!base)
      throw new Error(
        "Your checkout is on a detached HEAD: check out a branch first, for the goal to merge its work back into.",
      );
    const copy = await loadTeam(options.userTeam, repo.top);
    // What a member's environment lacks is said before anything is made.
    teamSettings(copy.settings, copy.team.members, options.env, options.plugins);
    const { slug, folder } = await newGoalFolder(goals.folder, name, await takenSlugs(repo));
    const files = goalFiles(folder);
    const me: Runner = { session: options.session, address: options.address };
    let engine: Engine | undefined;
    try {
      // A new folder: nobody else holds it.
      await takeLock(files.lock, me, (holder) => options.takeOver(holder, slug));
      await copyTeam(files.team, copy);
      const places: Places = { repo, slug, root: folder };
      await openGoal(places, base);
      const state: GoalState = {
        goal: {
          name,
          slug,
          status: "active",
          createdAt: Date.now(),
          settings: copy.goalSettings,
          base,
        },
        tasks: [],
        subtasks: [],
        meetings: [],
        questions: [],
        tokens: {},
      };
      engine = await Engine.ready(options, places, files, copy, state);
      engine.core.changed();
      await engine.writer.flush();
      return engine;
    } catch (error) {
      await Engine.leave(engine, files);
      await rm(folder, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * Takes a goal of the repository `cwd` is in up in this session, by its
   * slug, and resumes it (§3.2): a session that runs it is asked to let it
   * go, and what it stopped goes on here; what a session killed outright
   * left running is stopped first.
   */
  static async takeUp(options: EngineOptions, slug: string): Promise<Engine> {
    const goals = await RepositoryGoals.of(options.dataFolder, options.cwd);
    const { folder, files } = goals.goal(slug);
    if (!existsSync(files.state)) throw new Error(`There is no goal "${slug}" in this repository`);
    // What this cc-huddle can't read, or a member's environment lacks, is said before the goal is taken from where it runs.
    await readState(files.state);
    const { settings, team } = await readCopy(files.team);
    teamSettings(settings, team.members, options.env, options.plugins);
    const me: Runner = { session: options.session, address: options.address };
    const handed = await takeLock(files.lock, me, (holder) => options.takeOver(holder, slug));
    const stopped = handed.flatMap((h) => h.meetings);
    let engine: Engine | undefined;
    try {
      // Both again, as the session that let it go left them: it may have allowed a rule since.
      const state = await readState(files.state);
      const copy = await readCopy(files.team);
      const places = { repo: goals.repo, slug, root: folder };
      engine = await Engine.ready(options, places, files, copy, state);
      // A session killed outright couldn't pause it: it is paused first, as if it had.
      if (state.goal.status === "active") await engine.parts.goals.pause();
      await engine.parts.goals.resume(stopped);
      await engine.writer.flush();
      return engine;
    } catch (error) {
      await Engine.leave(engine, files);
      throw error;
    }
  }

  /** Lets a goal go that failed to open: what of its engine was made is shut, or else the lock and the record of members let go. */
  private static async leave(engine: Engine | undefined, files: Files) {
    if (engine) await engine.shut();
    else {
      await stopRecording();
      releaseLock(files.lock);
    }
  }

  /** The engine of a goal whose lock this process holds, put together; what a server before left running is stopped. */
  private static async ready(
    options: EngineOptions,
    places: Places,
    files: Files,
    copy: TeamFiles,
    state: GoalState,
  ): Promise<Engine> {
    await recordMembersIn(files.members, options.failed);
    const writer = stateWriter(files.state, () => state, options.failed);
    const records = new Records(places, options.failed);
    // Its calls reach into the engine, made just below.
    const core: Core = {
      state,
      team: copy.team,
      places,
      changed: () => {
        writer.changed();
        engine.parts.goals.settle();
      },
      allowAlways: (rules) => engine.allow(rules),
      options: (member, kind, cwd) => engine.turnOptions(member, kind, cwd),
      recorder: (id) => records.recorder(id),
      speech: (meeting) => records.speech(meeting),
      underWay: () => engine.parts.scheduler.underWay(),
      meetingsNow: () => engine.parts.meetings.now(),
      questionsNow: () => engine.parts.questions.now(),
      handingBack: () => engine.parts.goals.handingBack(),
    };
    const engine = new Engine(core, records, files, writer, options, copy);
    await engine.writeMemberSettings(copy);
    engine.parts.scheduler.recover();
    engine.parts.meetings.recover();
    return engine;
  }

  /** The goal as the rules read it (derive.ts). */
  get work(): Work {
    return workOf(this.core);
  }

  /** The goal's copy of the team. */
  get team(): Team {
    return this.core.team;
  }

  /** Switches how the goal works (§6.1). */
  switchSettings(change: Partial<GoalSettings>) {
    this.parts.goals.switchSettings(change);
  }

  /**
   * Answers a question put to you, and carries out a decision: on a subtask
   * (a stuck review, a merge, a task done), or on the goal (handing its work
   * back, cleaning up; §4.1). Cleaning up deletes the goal (delete): true
   * then. Throws when it is no longer open or the answer doesn't fit it.
   */
  async answer(id: string, answer: Answer): Promise<boolean> {
    const { questions, goals, scheduler } = this.parts;
    if (answer.kind !== "decision") {
      questions.answer(id, answer);
      return false;
    }
    const question = questions.find(id);
    if (question.kind !== "decision") throw new Error(DOESNT_FIT);
    if (answer.option === "cleanUp") {
      questions.answer(id, answer);
      await this.delete();
      return true;
    }
    if (onGoal(question) || GOAL_OPTIONS.includes(answer.option))
      await goals.decide(question, answer);
    else await scheduler.decide(id, answer);
    return false;
  }

  /**
   * Closes the goal as the session ends or lets it go (§3.2): an active goal
   * is paused, a merge under way finishes, the state is written for the last
   * time, and the goal is let go. Gives what it stopped: the meetings under
   * way, which pausing cancels.
   */
  async close(): Promise<HandedOver> {
    const { goal, meetings } = this.core.state;
    const stopped: HandedOver = {
      meetings: meetings.filter((m) => m.status === "running").map((m) => m.id),
    };
    try {
      if (goal.status === "active") await this.parts.goals.pause();
    } finally {
      await this.shut();
    }
    return stopped;
  }

  /**
   * Deletes an archived or closed goal for good (§4.1): its worktrees and
   * subtask branches, then its folder. An archived goal's branch stays,
   * yours to merge or delete; a closed goal's goes too.
   */
  async delete() {
    await this.parts.goals.delete();
    await this.shut();
    await rm(this.core.places.root, { recursive: true, force: true });
  }

  /**
   * Lets the goal go at once, as the process dies of an error: the lock is
   * released, and its members are stopped as the process exits
   * (stopMembers). The state stays as last written, and the next session to
   * take the goal up pauses what it left active.
   */
  abandon() {
    releaseLock(this.files.lock);
  }

  /**
   * Stops what runs, writes the state for the last time, and lets the goal
   * go, however that went: a goal still held by a session that let it go
   * would have the session taking it up ask again and again.
   */
  private async shut() {
    try {
      await Promise.all([
        this.parts.scheduler.close(),
        this.parts.meetings.close(),
        this.parts.goals.stop(),
      ]);
      await Promise.all([this.writer.close(), this.parts.records.flush()]);
    } finally {
      await stopRecording();
      releaseLock(this.files.lock);
    }
  }

  /**
   * Allows rules always (Questions): in the repository's team settings, for
   * goals started after, and in the goal's copy, for its members' next turns.
   * One at a time, so members' settings files end as the copy does.
   */
  private allow(rules: string[]) {
    return this.allowing("allow", async () => {
      await allowInTeam(this.core.places.repo.top, rules);
      this.copy = await allowInCopy(this.files.team, rules);
      await this.writeMemberSettings(this.copy);
    });
  }

  private readonly allowing = serialBy();

  /** Writes each member's settings file (teamSettings); throws before writing any when one can't be filled in. */
  private async writeMemberSettings({ settings, team }: TeamFiles) {
    const { env, plugins } = this.options;
    for (const [name, filled] of teamSettings(settings, team.members, env, plugins))
      await writeSettings(this.files.settings(name), filled);
  }

  private turnOptions(member: Member, kind: SessionKind, cwd: string) {
    const sessionMode = this.options.sessionMode();
    const seat = {
      member,
      claude: this.options.claude,
      cwd,
      settings: this.files.settings(member.name),
      system: systemPrompt(kind, member, this.core.team.members),
      ...(sessionMode && { sessionMode }),
      team: this.copy.settings,
    };
    return sessionOptions(seat, kind, this.options.env);
  }
}

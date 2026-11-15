/**
 * The engine for one goal (docs/design.md §3): its state, its copy of the
 * team and its parts, put together. It knows nothing of the plugin: what it
 * is to run with, and where its failures go, come in its options.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { errorText, type Core, type Team } from "./core.ts";
import {
  goalFiles,
  goalsFolder,
  newGoalFolder,
  openedGoal,
  readState,
  releaseGoal,
  repoFolder,
  stateWriter,
  takeGoal,
  type HandedOver,
  type Holder,
  type Runner,
  type StateWriter,
} from "./data.ts";
import { openGoal, openRepository, takenSlugs, type Places } from "./git.ts";
import { Goals } from "./goals.ts";
import { Meetings } from "./meetings.ts";
import { memberSettings, readOnlyOptions, workOptions, writeSettings } from "./policy.ts";
import { recordMembersIn, stopMembers, stopRecording } from "./processes.ts";
import { systemPrompt } from "./prompts.ts";
import { Questions, type Answer } from "./questions.ts";
import { Records } from "./records.ts";
import { Scheduler } from "./scheduler.ts";
import {
  allowInCopy,
  allowInTeam,
  copyTeam,
  loadTeam,
  readCopy,
  teamFolder,
  type TeamFiles,
} from "./team.ts";
import type { GoalState, MeetingSize, Question } from "./types.ts";

export interface EngineOptions {
  /** A folder in the repository. */
  cwd: string;
  /** openplan's data folder (`CLAUDE_PLUGIN_DATA`). */
  dataFolder: string;
  /** The Claude Code members run. */
  claude: string;
  /** The pid of the session the goal runs for, which the lock names. */
  session: number;
  /** Where this process is asked to let the goal go to another session, which the lock names too. */
  address: string;
  /** Asks the session that holds the goal `slug` to let it go, and gives what it stopped (§3.2). */
  takeOver: (holder: Holder, slug: string) => Promise<HandedOver>;
  /** Your session's permission mode as it is now, which members work in (§8); undefined before it is known. */
  sessionMode: () => PermissionMode | undefined;
  /** openplan's id as `enabledPlugins` names it, turned off in members' sessions. */
  plugin: string;
  /** Your own team's folder, under the repository's (team.ts userTeamFolder). */
  userTeam: string;
  /** The environment members' `${VAR}`s are filled in from. */
  env: Record<string, string | undefined>;
  /** Something went wrong that nobody waits on: the state or a record couldn't be written. */
  failed: (error: unknown) => void;
}

/** Where a goal's files are. */
type Files = ReturnType<typeof goalFiles>;

/**
 * Each member's settings: the team's settings, their environment filled in,
 * and the guards. Throws when a member's environment names a variable that
 * isn't set.
 */
function filledSettings({ team, settings }: TeamFiles, options: EngineOptions) {
  return team.members.map((member) => {
    try {
      return [member.name, memberSettings(settings, member, options.env, options.plugin)] as const;
    } catch (error) {
      throw new Error(`${member.name}: ${errorText(error)}`, { cause: error });
    }
  });
}

export class Engine {
  readonly questions: Questions;
  readonly scheduler: Scheduler;
  readonly meetings: Meetings;
  readonly goals: Goals;
  /** The team's settings set the members' permission mode, over your session's. */
  private teamMode = false;

  private constructor(
    private readonly core: Core,
    readonly records: Records,
    private readonly files: Files,
    private readonly writer: StateWriter,
    private readonly options: EngineOptions,
    private copy: TeamFiles,
  ) {
    this.questions = new Questions(core);
    this.scheduler = new Scheduler(core, this.questions);
    this.meetings = new Meetings(core, this.scheduler);
    this.goals = new Goals(core, this.scheduler, this.meetings);
  }

  /**
   * Starts a goal for this session: a folder of its own, the team copied
   * into it as its files have it now (§6), and its branch cut from your
   * HEAD, checked out in its own worktree.
   */
  static async start(options: EngineOptions, name: string): Promise<Engine> {
    const repo = await openRepository(options.cwd);
    const copy = await loadTeam([options.userTeam, teamFolder(repo.top)]);
    // What a member's environment lacks is said before anything is made.
    filledSettings(copy, options);
    const { slug, folder } = await newGoalFolder(
      repoFolder(options.dataFolder, repo),
      name,
      await takenSlugs(repo),
    );
    const files = goalFiles(folder);
    const me: Runner = { session: options.session, address: options.address };
    try {
      // A new folder: nobody else holds it.
      await takeGoal(files.lock, me, (holder) => options.takeOver(holder, slug));
      await copyTeam(files.team, copy);
      const places: Places = { repo, root: folder };
      await openGoal(places, slug);
      const state: GoalState = {
        goal: { id: randomUUID(), name, slug, status: "active", createdAt: Date.now() },
        tasks: [],
        subtasks: [],
        meetings: [],
        questions: [],
      };
      const engine = await Engine.ready(options, places, files, copy, state);
      engine.core.changed();
      await engine.writer.flush();
      await openedGoal(files.lock, me);
      return engine;
    } catch (error) {
      releaseGoal(files.lock);
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
    const repo = await openRepository(options.cwd);
    const folder = path.join(goalsFolder(repoFolder(options.dataFolder, repo)), slug);
    const files = goalFiles(folder);
    if (!existsSync(files.state)) throw new Error(`There is no goal "${slug}" in this repository`);
    const me: Runner = { session: options.session, address: options.address };
    const handed = await takeGoal(files.lock, me, (holder) => options.takeOver(holder, slug));
    try {
      const state = await readState(files.state);
      const engine = await Engine.ready(
        options,
        { repo, root: folder },
        files,
        await readCopy(files.team),
        state,
      );
      // A session killed outright couldn't pause it: it is paused first, as if it had.
      if (state.goal.status === "active") await engine.goals.pause();
      await engine.goals.resume(handed.meetings);
      await engine.writer.flush();
      await openedGoal(files.lock, me);
      return engine;
    } catch (error) {
      releaseGoal(files.lock);
      throw error;
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
    await recordMembersIn(files.members);
    const writer = stateWriter(files.state, () => state, options.failed);
    const records = new Records(places, options.failed);
    // Its calls reach into the engine, made just below.
    const core: Core = {
      state,
      team: copy.team,
      places,
      changed: () => {
        writer.changed();
      },
      allowAlways: (rules) => engine.allow(rules),
      options: (member, kind, cwd) => engine.turnOptions(member, kind, cwd),
      recorder: (subtask) => records.recorder(subtask.id),
      speech: (meeting, speaker) => records.speech(meeting, speaker),
    };
    const engine = new Engine(core, records, files, writer, options, copy);
    await engine.writeMemberSettings(copy);
    engine.questions.recover();
    engine.scheduler.recover();
    engine.meetings.recover();
    return engine;
  }

  get state(): GoalState {
    return this.core.state;
  }

  /** The goal's copy of the team. */
  get team(): Team {
    return this.core.team;
  }

  /** The size a meeting has unless you say. */
  get meetingSize(): MeetingSize {
    return this.copy.meetingSize;
  }

  /**
   * Answers a question put to you, and carries out a decision (a stuck
   * review, a merge, a task done). Throws when it is no longer open or the
   * answer doesn't fit it.
   */
  async answer(id: string, answer: Answer): Promise<Question> {
    const question = this.questions.answer(id, answer);
    if (question.kind === "decision" && "decision" in answer)
      await this.scheduler.decide(question, answer);
    return question;
  }

  /**
   * Closes the goal as the session ends or lets it go (§3.2): an active goal
   * is paused, a merge under way finishes, the state is written for the last
   * time, and the goal is let go. Gives what it stopped: the meetings under
   * way, which pausing cancels.
   */
  async close(): Promise<HandedOver> {
    const { goal, meetings } = this.state;
    const stopped: HandedOver = {
      meetings: meetings.filter((m) => m.status === "running").map((m) => m.id),
    };
    try {
      if (goal.status === "active") await this.goals.pause();
    } finally {
      await this.shut();
    }
    return stopped;
  }

  /**
   * Deletes an archived goal for good (§4.1): its worktrees and subtask
   * branches, then its folder. Its branch stays, yours to merge or delete.
   */
  async delete() {
    await this.goals.delete();
    await this.shut();
    await rm(this.core.places.root, { recursive: true, force: true });
  }

  /**
   * Lets the goal go at once, as the process dies of an error: its members
   * are stopped and the lock released. The state stays as last written, and
   * the next session to take the goal up pauses what it left active.
   */
  abandon() {
    stopMembers();
    releaseGoal(this.files.lock);
  }

  /**
   * Stops what runs, writes the state for the last time, and lets the goal
   * go, however that went: a goal still held by a session that let it go
   * would have the session taking it up ask again and again.
   */
  private async shut() {
    try {
      await Promise.all([this.scheduler.close(), this.meetings.close()]);
      await Promise.all([this.writer.close(), this.records.flush()]);
    } finally {
      stopRecording();
      releaseGoal(this.files.lock);
    }
  }

  /**
   * Allows rules always (Questions): in the repository's team settings, for
   * goals started after, and in the goal's copy, for its members' next turns.
   */
  private async allow(rules: string[]) {
    await allowInTeam(this.core.places.repo.top, rules);
    this.copy = await allowInCopy(this.files.team, rules);
    await this.writeMemberSettings(this.copy);
  }

  /** Writes each member's settings file (filledSettings); throws before writing any when one can't be filled in. */
  private async writeMemberSettings(copy: TeamFiles) {
    for (const [name, filled] of filledSettings(copy, this.options))
      await writeSettings(this.files.settings(name), filled);
    this.teamMode = copy.settings.permissions?.defaultMode !== undefined;
  }

  private turnOptions(...[member, kind, cwd]: Parameters<Core["options"]>) {
    const seat = {
      member,
      claude: this.options.claude,
      cwd,
      settings: this.files.settings(member.name),
      system: systemPrompt(kind, member, this.core.team.members),
    };
    if (kind !== "task") return readOnlyOptions(seat, this.options.env);
    const mode = this.teamMode ? undefined : this.options.sessionMode();
    return workOptions({ ...seat, ...(mode && { mode }) }, this.options.env);
  }
}

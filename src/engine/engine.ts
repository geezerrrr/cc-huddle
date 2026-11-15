/**
 * The engine for one repository (docs/design.md §3): its state, its team and
 * its parts, put together. It knows nothing of the plugin: what it is to run
 * with, and where its failures go, come in its options.
 */
import type { Settings } from "@anthropic-ai/claude-agent-sdk";
import { errorText, type Core, type Team } from "./core.ts";
import {
  dataFiles,
  openedTeam,
  readState,
  releaseTeam,
  repoFolder,
  stateWriter,
  takeTeam,
  type HandedOver,
  type Holder,
  type StateWriter,
} from "./data.ts";
import { openRepository, type Places } from "./git.ts";
import { Goals } from "./goals.ts";
import { Meetings } from "./meetings.ts";
import { memberSettings, readOnlyOptions, workOptions, writeSettings } from "./policy.ts";
import { recordMembersIn, stopMembers, stopRecording } from "./processes.ts";
import { systemPrompt } from "./prompts.ts";
import { Questions, type Answer } from "./questions.ts";
import { Records } from "./records.ts";
import { Scheduler } from "./scheduler.ts";
import { allowInTeam, loadTeam, teamFolder } from "./team.ts";
import type { MeetingSize, Question, TeamState } from "./types.ts";

export interface EngineOptions {
  /** A folder in the repository. */
  cwd: string;
  /** openplan's data folder (`CLAUDE_PLUGIN_DATA`). */
  dataFolder: string;
  /** The Claude Code members run. */
  claude: string;
  /** The pid of the session the team runs for, which the lock names. */
  session: number;
  /** Where this process is asked to let the team go to another session, which the lock names too. */
  address: string;
  /**
   * Asks the session that holds the team to let it go, and gives what it
   * stopped (§3.2). Without it, the team opens only when nobody holds it.
   */
  takeOver?: (holder: Holder) => Promise<HandedOver>;
  /** openplan's id as `enabledPlugins` names it, turned off in members' sessions. */
  plugin: string;
  /** Your own team's folder, under the repository's (team.ts userTeamFolder). */
  userTeam: string;
  /** The environment members' `${VAR}`s are filled in from. */
  env: Record<string, string | undefined>;
  /** The team as it is read: as it opens, and whenever it is read again. */
  teamRead: (team: Team) => void;
  /** Something went wrong that nobody waits on: the state or a record couldn't be written. */
  failed: (error: unknown) => void;
}

export class Engine {
  readonly questions: Questions;
  readonly scheduler: Scheduler;
  readonly meetings: Meetings;
  readonly goals: Goals;
  /** How many times the state has changed since the team opened. */
  private changes = 0;

  private constructor(
    private readonly core: Core,
    readonly records: Records,
    private readonly files: ReturnType<typeof dataFiles>,
    private readonly writer: StateWriter,
    private readonly options: EngineOptions,
    private size: MeetingSize,
  ) {
    this.questions = new Questions(core);
    this.scheduler = new Scheduler(core, this.questions);
    this.meetings = new Meetings(core, this.scheduler);
    this.goals = new Goals(core, this.scheduler, this.meetings);
  }

  /**
   * Opens the team of the repository `cwd` is in, for this session alone:
   * what a server before left running is stopped, and the goals it left
   * active are paused, as when a session closes (§3.2). What a session
   * handed over as it let the team go is resumed.
   */
  static async open(options: EngineOptions): Promise<Engine> {
    const repo = await openRepository(options.cwd);
    const root = repoFolder(options.dataFolder, repo);
    const files = dataFiles(root);
    // A repository without a team gets no lock or folder of openplan's.
    const { team, settings, meetingSize } = await loadTeam([
      options.userTeam,
      teamFolder(repo.top),
    ]);
    const me = { session: options.session, address: options.address };
    const handed = await takeTeam(files.lock, me, options.takeOver);
    try {
      await recordMembersIn(files.members);
      const state = await readState(files.state);
      const writer = stateWriter(files.state, () => state, options.failed);
      const places: Places = { repo, root };
      const records = new Records(places, options.failed);
      // Its calls reach into the engine, made just below.
      const core: Core = {
        state,
        team,
        places,
        changed: () => {
          engine.changes++;
          writer.changed();
        },
        allowAlways: (rules) => engine.allow(rules),
        options: (member, kind, cwd) => engine.turnOptions(member, kind, cwd),
        recorder: (subtask) => records.recorder(subtask.id),
        speech: (meeting, speaker) => records.speech(meeting, speaker),
      };
      const engine = new Engine(core, records, files, writer, options, meetingSize);
      await engine.writeMemberSettings(team, settings);
      options.teamRead(team);
      engine.questions.recover();
      engine.scheduler.recover();
      engine.meetings.recover();
      for (const goal of state.goals)
        if (goal.status === "active") await engine.goals.pause(goal.id);
      await engine.goals.carryOn(handed);
      await writer.flush();
      await openedTeam(files.lock, me);
      return engine;
    } catch (error) {
      releaseTeam(files.lock);
      throw error;
    }
  }

  get state(): TeamState {
    return this.core.state;
  }

  get team(): Team {
    return this.core.team;
  }

  /** Changes as the state does: the same number, the same state. */
  get revision(): number {
    return this.changes;
  }

  /** The size a meeting has unless you say. */
  get meetingSize(): MeetingSize {
    return this.size;
  }

  /**
   * Reads the team's files again: roles, members, their settings, openplan's
   * own. When they can't be read, the team stays as it was.
   */
  async reloadTeam() {
    const { team, settings, meetingSize } = await loadTeam([
      this.options.userTeam,
      teamFolder(this.core.places.repo.top),
    ]);
    await this.writeMemberSettings(team, settings);
    this.core.team = team;
    this.size = meetingSize;
    this.options.teamRead(team);
    this.core.changed();
    this.scheduler.pump();
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
   * Closes the team as the session ends or hands it over (§3.2): every
   * active goal is paused, a merge under way finishes, the state is written
   * for the last time, and the team is let go. Gives what it stopped: the
   * goals, and the meetings under way, which their pausing cancels.
   */
  async close(): Promise<HandedOver> {
    const { goals, meetings } = this.state;
    const stopped: HandedOver = {
      goals: goals.filter((g) => g.status === "active").map((g) => g.id),
      meetings: meetings.filter((m) => m.status === "running").map((m) => m.id),
    };
    for (const id of stopped.goals) await this.goals.pause(id);
    await Promise.all([this.scheduler.close(), this.meetings.close()]);
    await Promise.all([this.writer.close(), this.records.flush()]);
    stopRecording();
    releaseTeam(this.files.lock);
    return stopped;
  }

  /**
   * Lets the team go at once, as the process dies of an error: its members
   * are stopped and the lock released. The state stays as last written, and
   * the next session pauses what it left active.
   */
  abandon() {
    stopMembers();
    releaseTeam(this.files.lock);
  }

  /** Adds allow rules to the team's settings (Questions: allow always), for every member's next turns. */
  private async allow(rules: string[]) {
    await allowInTeam(this.core.places.repo.top, rules);
    await this.reloadTeam();
  }

  /**
   * Writes each member's settings file: the team's settings, their
   * environment filled in, and the guards. Throws before writing any when a
   * member's environment names a variable that isn't set.
   */
  private async writeMemberSettings(team: Team, settings: Settings) {
    const { plugin } = this.options;
    const each = team.members.map((member) => {
      try {
        return [member.name, memberSettings(settings, member, this.options.env, plugin)] as const;
      } catch (error) {
        throw new Error(`${member.name}: ${errorText(error)}`, { cause: error });
      }
    });
    for (const [name, filled] of each) await writeSettings(this.files.settings(name), filled);
  }

  private turnOptions(...[member, kind, cwd]: Parameters<Core["options"]>) {
    const seat = {
      member,
      claude: this.options.claude,
      cwd,
      settings: this.files.settings(member.name),
      system: systemPrompt(kind, member, this.core.team.members),
    };
    return kind === "task"
      ? workOptions(seat, this.options.env)
      : readOnlyOptions(seat, this.options.env);
  }
}

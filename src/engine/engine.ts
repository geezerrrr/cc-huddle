/**
 * The engine for one repository (docs/design.md §3): its state, its team and
 * its parts, put together. It knows nothing of the plugin: what its turns say
 * goes where its host says.
 */
import type { Settings } from "@anthropic-ai/claude-agent-sdk";
import { errorText, type Core, type Team } from "./core.ts";
import {
  dataFiles,
  readState,
  releaseTeam,
  repoFolder,
  stateWriter,
  takeTeam,
  type StateWriter,
} from "./data.ts";
import { openRepository, type Places } from "./git.ts";
import { Goals } from "./goals.ts";
import { Meetings } from "./meetings.ts";
import { memberSettings, pluginId, readOnlyOptions, workOptions, writeSettings } from "./policy.ts";
import { recordMembersIn } from "./processes.ts";
import { systemPrompt } from "./prompts.ts";
import { Questions } from "./questions.ts";
import { Scheduler } from "./scheduler.ts";
import { allowInTeam, loadTeam } from "./team.ts";
import type { TurnListener } from "./turns.ts";
import type { Meeting, MeetingSize, Subtask, TeamState } from "./types.ts";

/** Where the engine tells what happens. */
export interface Host {
  /** The state changed. */
  changed(): void;
  /** Where what a subtask's runs do is told. */
  recorder(subtask: Subtask): TurnListener;
  /** Where what is said at a meeting is told as it is said. */
  speech(meeting: Meeting, speaker: string): TurnListener;
  /** Something went wrong that nobody waits on: the state couldn't be written. */
  failed(error: unknown): void;
}

export interface EngineOptions {
  /** A folder in the repository. */
  cwd: string;
  /** openplan's data folder (`CLAUDE_PLUGIN_DATA`). */
  dataFolder: string;
  /** The environment members' `${VAR}`s are filled in from. */
  env: Record<string, string | undefined>;
  host: Host;
}

export class Engine {
  readonly questions: Questions;
  readonly scheduler: Scheduler;
  readonly meetings: Meetings;
  readonly goals: Goals;

  private constructor(
    private readonly core: Core,
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
   * active are paused, as when a session closes (§3.2).
   */
  static async open(options: EngineOptions): Promise<Engine> {
    const repo = await openRepository(options.cwd);
    const root = repoFolder(options.dataFolder, repo);
    const files = dataFiles(root);
    await takeTeam(files.lock);
    try {
      await recordMembersIn(files.members);
      const { team, settings, meetingSize } = await loadTeam(repo.top);
      const state = await readState(files.state);
      const { host } = options;
      const writer = stateWriter(
        files.state,
        () => state,
        (error) => {
          host.failed(error);
        },
      );
      const places: Places = { repo, root };
      // Its calls reach into the engine, made just below.
      const core: Core = {
        state,
        team,
        places,
        changed: () => {
          writer.changed();
          host.changed();
        },
        allowAlways: (rules) => engine.allow(rules),
        options: (member, kind, cwd) => Promise.resolve(engine.turnOptions(member, kind, cwd)),
        recorder: (subtask) => host.recorder(subtask),
        speech: (meeting, speaker) => host.speech(meeting, speaker),
      };
      const engine = new Engine(core, files, writer, options, meetingSize);
      await engine.writeMemberSettings(team, settings);
      engine.questions.recover();
      engine.scheduler.recover();
      engine.meetings.recover();
      for (const goal of state.goals)
        if (goal.status === "active") await engine.goals.pause(goal.id);
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

  /** The size a meeting has unless you say. */
  get meetingSize(): MeetingSize {
    return this.size;
  }

  /**
   * Reads the team's files again: roles, members, their settings, openplan's
   * own. When they can't be read, the team stays as it was.
   */
  async reloadTeam() {
    const { team, settings, meetingSize } = await loadTeam(this.core.places.repo.top);
    await this.writeMemberSettings(team, settings);
    this.core.team = team;
    this.size = meetingSize;
    this.core.changed();
    this.scheduler.pump();
  }

  /**
   * Closes the team as the session ends (§3.2): every active goal is paused,
   * a merge under way finishes, and the state is written.
   */
  async close() {
    for (const goal of this.state.goals)
      if (goal.status === "active") await this.goals.pause(goal.id);
    await Promise.all([this.scheduler.close(), this.meetings.close()]);
    this.writer.changed();
    await this.writer.flush();
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
    const plugin = pluginId(this.options.dataFolder);
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
      cwd,
      settings: this.files.settings(member.name),
      system: systemPrompt(kind, member, this.core.team.members),
    };
    return kind === "task"
      ? workOptions(seat, this.options.env)
      : readOnlyOptions(seat, this.options.env);
  }
}

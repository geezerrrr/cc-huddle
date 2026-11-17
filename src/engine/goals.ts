/**
 * The goal's life (docs/design.md §4.1): the goals' state machine
 * (GOAL_MACHINE) and what a goal's life reaches into: its work and its
 * meetings, its branch and worktrees, and handing its work back once it is
 * done (§5). One change to its life at a time, and asking twice is the same
 * as asking once. Also how the goal works, as you switch it (§6.1).
 */
import { HAND_BACK, REFUSED, spend, workOf, type Core } from "./core.ts";
import { lastAcceptance, over, type Work } from "./derive.ts";
import { handBackGoal, hasWork, removeGoal } from "./git.ts";
import { can, GOAL_MACHINE, step } from "./machines.ts";
import type { Meetings } from "./meetings.ts";
import { handBackPrompt } from "./prompts.ts";
import { DOESNT_FIT, type DecisionAnswer, type Questions } from "./questions.ts";
import type { Scheduler } from "./scheduler.ts";
import { runTurn, turnDecoder } from "./turns.ts";
import { errorText } from "../shared/errors.ts";
import { goalFiles } from "../shared/layout.ts";
import { serialBy } from "../shared/serial.ts";
import {
  DECISIONS,
  hostOf,
  onGoal,
  type DecisionQuestion,
  type Goal,
  type GoalSettings,
} from "./types.ts";

/** The key the goal's changes take turns on. */
const LIFE = "life";

/**
 * The goal handing its work back, or finding out whether it has any to: how
 * to stop it, who resolves its conflicts while one does, and when it ends.
 */
interface HandingBack {
  abort: AbortController;
  by?: string;
  ended?: Promise<void>;
}

export class Goals {
  private readonly life = serialBy();
  private handing: HandingBack | undefined;

  constructor(
    private readonly core: Core,
    private readonly scheduler: Scheduler,
    private readonly meetings: Meetings,
    private readonly questions: Questions,
  ) {}

  /**
   * Pauses the goal: its runs stop, to go on in their sessions when it is
   * resumed, and a meeting under way is cancelled; a plan in review stays,
   * to approve once it goes on. Handing its work back stops, to be asked
   * again as it resumes.
   */
  pause(): Promise<void> {
    return this.life(LIFE, () => {
      const { goal } = this;
      if (goal.status === "paused") return;
      if (goal.status === "archived") throw new Error(REFUSED.archived(goal));
      if (goal.status === "closed") throw new Error(REFUSED.closed(goal));
      goal.status = step(GOAL_MACHINE, goal.status, "pause");
      this.hold(false);
    });
  }

  /** Archives the goal as it stands: its work held as when paused, and its plans in review dropped. */
  archive(): Promise<void> {
    return this.life(LIFE, () => {
      const { goal } = this;
      if (goal.status === "archived") return;
      if (goal.status === "closed") throw new Error(REFUSED.closed(goal));
      goal.status = step(GOAL_MACHINE, goal.status, "archive");
      this.hold(true);
    });
  }

  /**
   * Puts a paused or archived goal back to work, from where it was; then the
   * meetings a session stopped as it let the goal go (§3.2), and only then
   * other work, so a meeting's members go back to it before anything else
   * takes them.
   */
  resume(meetings: readonly string[] = []): Promise<void> {
    return this.life(LIFE, () => {
      if (!this.wake()) return;
      for (const id of meetings) this.meetings.resume(id);
      this.core.changed();
      this.scheduler.pump();
    });
  }

  /**
   * Takes an archived or closed goal out of the repository for good: its
   * subtasks' worktrees and branches, and its own worktree. An archived
   * goal's branch stays, yours to merge or delete; a closed one's goes too.
   * The engine removes the goal's folder after (Engine.delete).
   */
  delete(): Promise<void> {
    return this.life(LIFE, async () => {
      const { core, goal } = this;
      if (!can(GOAL_MACHINE, goal.status, "delete"))
        throw new Error(
          `The goal "${goal.name}" isn't archived or closed: archive it before deleting it`,
        );
      // A merge under way finishes first, and so does a meeting being cancelled.
      await this.scheduler.release(core.state.subtasks.map((s) => s.id));
      await this.meetings.settled();
      await removeGoal(core.places, goal.status === "closed");
    });
  }

  /** Stops handing the work back, as the engine shuts; settles once it has ended. */
  async stop() {
    this.handing?.abort.abort();
    await this.handing?.ended;
  }

  /** The goal handing its work back now, for the rules to read (Work.handingBack). */
  handingBack(): Work["handingBack"] {
    const { handing } = this;
    return handing && (handing.by === undefined ? {} : { by: handing.by });
  }

  /**
   * Moves an active goal on as its plan does (§4.1); the state changed, and
   * this asks after every change. Its plan dropped, it closes. Its work done,
   * the acceptance that is all it waits on offers to hand the work back too;
   * with none waiting, it asks to hand the work back, or closes when there
   * is none to.
   */
  settle() {
    const { goal } = this;
    if (goal.status !== "active" || this.handing) return;
    const work = workOf(this.core);
    const last = lastAcceptance(work);
    if (last && !last.decision.options.includes("acceptMerge"))
      this.questions.reask(last, DECISIONS.lastDelivery());
    if (!over(work)) return;
    if (!work.tasks.length) this.close();
    else if (!work.questions.some(onGoal)) this.offer();
  }

  /**
   * Carries out your decision on the goal (§4.1), or on the acceptance that
   * is all it waits on: merge (accepting it too) hands the work back; not
   * now (accepting it only) pauses the goal, which asks again as it resumes;
   * keep leaves a closed goal as it is. Cleaning up is the engine's
   * (Engine.answer). Throws as answering does.
   */
  async decide(question: DecisionQuestion, answer: DecisionAnswer) {
    if (!question.decision.options.includes(answer.option)) throw new Error(DOESNT_FIT);
    const active = this.goal.status === "active";
    switch (answer.option) {
      case "merge":
      case "acceptMerge": {
        // Taken before the answer: as it leaves, nothing asks again meanwhile.
        const handing = active ? this.take() : undefined;
        try {
          if (answer.option === "merge") this.questions.answer(question.id, answer);
          else await this.scheduler.decide(question.id, answer);
        } catch (error) {
          if (handing) this.let(handing);
          throw error;
        }
        if (handing) handing.ended = this.handBack(handing);
        return;
      }
      case "acceptOnly":
        if (active) await this.pause();
        await this.scheduler.decide(question.id, answer);
        return;
      case "notNow":
        // Pausing calls it off: asked again as the goal resumes.
        await this.pause();
        return;
      default:
        this.questions.answer(question.id, answer);
    }
  }

  /** Switches how the goal works, from its next delivery and meeting on. */
  switchSettings(change: Partial<GoalSettings>) {
    const { goal } = this;
    goal.settings = { ...goal.settings, ...change };
    this.core.changed();
  }

  /** Makes the goal active again; false when it was already. */
  private wake(): boolean {
    const { goal } = this;
    if (goal.status === "active") return false;
    if (goal.status === "closed") throw new Error(REFUSED.closed(goal));
    goal.status = step(GOAL_MACHINE, goal.status, "resume");
    return true;
  }

  private get goal(): Goal {
    return this.core.state.goal;
  }

  /**
   * Holds the goal's work, cancels its meeting under way and, `plansToo`,
   * its plans in review; stops handing its work back, and calls off asking
   * to.
   */
  private hold(plansToo: boolean) {
    this.scheduler.hold();
    for (const meeting of this.core.state.meetings)
      if (meeting.status === "running" || (plansToo && meeting.status === "review"))
        void this.meetings.cancel(meeting.id);
    this.handing?.abort.abort();
    this.questions.cancelHandBack();
    this.core.changed();
  }

  /** Closes the goal (§4.1), and asks whether to clean it up. */
  private close() {
    const { goal } = this;
    goal.status = step(GOAL_MACHINE, goal.status, "close");
    this.questions.openDecision({ from: this.lead }, DECISIONS.cleanUp(), "");
  }

  /** Asks to hand the work back; `text`, why it came back, if it did. */
  private ask(text: string) {
    this.questions.openDecision({ from: this.lead }, DECISIONS.handBack(), text);
  }

  /** Asks to hand the work back once the goal's branch has commits the one it was cut from lacks; else closes. */
  private offer() {
    const handing = this.take();
    handing.ended = hasWork(this.core.places, this.goal.base)
      .then(
        (any) => {
          this.let(handing);
          if (this.goal.status !== "active") return;
          if (any) this.ask("");
          else this.close();
        },
        (error: unknown) => {
          this.let(handing);
          if (this.goal.status === "active") this.ask(errorText(error));
        },
      )
      .finally(() => {
        this.core.changed();
      });
  }

  /**
   * Hands the work back (§5): `base` merged into the goal's branch, its
   * conflicts resolved by the lead in a session of their own, then `base`
   * fast-forwarded to it. Merged, the goal closes; else it comes back to
   * you, saying why. Paused meanwhile, it stops, to be asked again.
   */
  private async handBack(handing: HandingBack) {
    const { core } = this;
    const { signal } = handing.abort;
    const by = this.lead;
    try {
      let merged = await handBackGoal(core.places, this.goal.base, by);
      if (merged.kind === "conflict") {
        handing.by = by;
        core.changed();
        await this.resolve(by, merged.files, signal);
        merged = await handBackGoal(core.places, this.goal.base, by);
        if (merged.kind === "conflict")
          throw new Error(`Conflicts are left in ${merged.files.join(", ")}`);
      }
      this.let(handing);
      // Paused meanwhile, it closes as it resumes: nothing is left to hand back.
      if (can(GOAL_MACHINE, this.goal.status, "close")) this.close();
    } catch (error) {
      this.let(handing);
      if (!signal.aborted && this.goal.status === "active") this.ask(errorText(error));
    } finally {
      core.changed();
    }
  }

  /** The member `by` resolves the hand-back's `files` in conflict, in the goal's worktree, in a session of their own. */
  private async resolve(by: string, files: string[], signal: AbortSignal) {
    const { core } = this;
    const member = core.team.members.find((m) => m.name === by);
    if (!member) throw new Error(`${by} isn't on the goal's team`);
    const cwd = goalFiles(core.places.root).checkout;
    const outcome = await runTurn(
      handBackPrompt({ goal: this.goal, cwd, files }),
      {
        ...core.options(member, "merge", cwd),
        canUseTool: this.questions.gate({ from: by, signal }),
      },
      signal,
      turnDecoder(core.recorder(HAND_BACK)),
    );
    spend(core.state, by, outcome.tokens);
    if (!outcome.ok) throw new Error(outcome.error);
  }

  /**
   * Who leads the goal's end: resolves its hand-back's conflicts, and puts
   * its decisions to you. The host of its meeting, else the member its work
   * was given to.
   */
  private get lead(): string {
    const { meetings, subtasks } = this.core.state;
    const meeting = meetings.find((m) => m.status === "approved") ?? meetings[0];
    const lead = meeting ? hostOf(meeting) : subtasks[0]?.assignee;
    if (lead === undefined) throw new Error("The goal has neither a meeting nor work");
    return lead;
  }

  /** Marks the goal handing its work back, or finding out whether it has any to. */
  private take(): HandingBack {
    const handing: HandingBack = { abort: new AbortController() };
    this.handing = handing;
    return handing;
  }

  /** Lets go of `handing`, unless another took its place. */
  private let(handing: HandingBack) {
    if (this.handing === handing) this.handing = undefined;
  }
}

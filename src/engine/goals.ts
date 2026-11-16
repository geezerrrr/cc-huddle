/**
 * The goal's life (docs/design.md §4.1): the goals' state machine
 * (GOAL_MACHINE) and what a goal's life reaches into: its work and its
 * meetings, its branch and worktrees. One change to its life at a time, and
 * asking twice is the same as asking once. Also how the goal works, as you
 * switch it (§6.1).
 */
import { REFUSED, type Core } from "./core.ts";
import { removeGoal } from "./git.ts";
import { can, GOAL_MACHINE, step } from "./machines.ts";
import type { Meetings } from "./meetings.ts";
import type { Scheduler } from "./scheduler.ts";
import { serialBy } from "../shared/serial.ts";
import type { Goal, GoalSettings } from "./types.ts";

/** The key the goal's changes take turns on. */
const LIFE = "life";

export class Goals {
  private readonly life = serialBy();

  constructor(
    private readonly core: Core,
    private readonly scheduler: Scheduler,
    private readonly meetings: Meetings,
  ) {}

  /**
   * Pauses the goal: its runs stop, to go on in their sessions when it is
   * resumed, and a meeting under way is cancelled; a plan in review stays,
   * to approve once it goes on.
   */
  pause(): Promise<void> {
    return this.life(LIFE, () => {
      const { goal } = this;
      if (goal.status === "paused") return;
      if (goal.status === "archived") throw new Error(REFUSED.archived(goal));
      goal.status = step(GOAL_MACHINE, goal.status, "pause");
      this.hold(false);
    });
  }

  /** Archives the goal as it stands: its work held as when paused, and its plans in review dropped. */
  archive(): Promise<void> {
    return this.life(LIFE, () => {
      const { goal } = this;
      if (goal.status === "archived") return;
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
   * Takes an archived goal out of the repository for good: its subtasks'
   * worktrees and branches, and its own worktree. Its branch stays, yours to
   * merge or delete. The engine removes the goal's folder after (Engine.delete).
   */
  delete(): Promise<void> {
    return this.life(LIFE, async () => {
      const { core, goal } = this;
      if (!can(GOAL_MACHINE, goal.status, "delete"))
        throw new Error(`The goal "${goal.name}" isn't archived: archive it before deleting it`);
      // A merge under way finishes first, and so does a meeting being cancelled.
      await this.scheduler.release(core.state.subtasks.map((s) => s.id));
      await this.meetings.settled();
      await removeGoal(core.places);
    });
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
    goal.status = step(GOAL_MACHINE, goal.status, "resume");
    return true;
  }

  private get goal(): Goal {
    return this.core.state.goal;
  }

  /** Holds the goal's work, cancels its meeting under way and, `plansToo`, its plans in review. */
  private hold(plansToo: boolean) {
    this.scheduler.hold();
    for (const meeting of this.core.state.meetings)
      if (meeting.status === "running" || (plansToo && meeting.status === "review"))
        void this.meetings.cancel(meeting.id);
    this.core.changed();
  }
}

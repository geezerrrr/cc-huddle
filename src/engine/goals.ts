/**
 * Goals (docs/design.md §4.1): the goals' state machine (GOAL_MACHINE) and
 * what a goal's life reaches into: its branch and worktrees, its work and its
 * meetings. One change to a goal's life at a time, and asking twice is the
 * same as asking once.
 */
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import type { Core } from "./core.ts";
import type { HandedOver } from "./data.ts";
import { openGoal, removeGoal, slugFor, takenSlugs } from "./git.ts";
import { can, GOAL_MACHINE, step } from "./machines.ts";
import type { Meetings } from "./meetings.ts";
import { recordFile } from "./records.ts";
import type { Scheduler } from "./scheduler.ts";
import { serialBy } from "./serial.ts";
import type { Goal, Subtask } from "./types.ts";

/**
 * Starts and resumes take turns: each start picks a slug no other goal has,
 * and each finds no other goal active (§4.1).
 */
const ACTIVATING = "activate";

/** A subtask you give a member directly, without a meeting. */
export interface DirectWork {
  title: string;
  description: string;
  acceptance: string;
  assignee: string;
}

export class Goals {
  private readonly life = serialBy();

  constructor(
    private readonly core: Core,
    private readonly scheduler: Scheduler,
    private readonly meetings: Meetings,
  ) {}

  /** Starts a goal: its branch cut from your HEAD, checked out in its own worktree. */
  start(name: string): Promise<Goal> {
    return this.life(ACTIVATING, async () => {
      const { core } = this;
      this.onlyOne();
      const taken = await takenSlugs(core.places.repo);
      for (const goal of core.state.goals) taken.add(goal.slug);
      const goal: Goal = {
        id: randomUUID(),
        name,
        slug: slugFor(name, taken),
        status: "active",
        createdAt: Date.now(),
      };
      await openGoal(core.places, goal.slug);
      core.state.goals.push(goal);
      core.changed();
      return goal;
    });
  }

  /**
   * Pauses a goal: its runs stop, to go on in their sessions when it is
   * resumed, and a meeting under way is cancelled; a plan in review stays,
   * to approve once it goes on.
   */
  pause(id: string): Promise<void> {
    return this.life(id, () => {
      const goal = this.goal(id);
      if (goal.status === "paused") return;
      if (goal.status === "archived")
        throw new Error(`The goal "${goal.name}" is archived: resume it first`);
      goal.status = step(GOAL_MACHINE, goal.status, "pause");
      this.hold(goal, false);
    });
  }

  /** Archives a goal as it stands: its work held as when paused, and its plans in review dropped. */
  archive(id: string): Promise<void> {
    return this.life(id, () => {
      const goal = this.goal(id);
      if (goal.status === "archived") return;
      goal.status = step(GOAL_MACHINE, goal.status, "archive");
      goal.archivedAt = Date.now();
      this.hold(goal, true);
    });
  }

  /** Puts a paused or archived goal back to work, from where it was. */
  resume(id: string): Promise<void> {
    return this.life(id, () =>
      this.life(ACTIVATING, () => {
        if (!this.wake(this.goal(id))) return;
        this.core.changed();
        this.scheduler.pump();
      }),
    );
  }

  /**
   * Puts back what a session stopped as it handed the team over (§3.2): its
   * goals, then their meetings, and only then other work, so a meeting's
   * members go back to it before anything else takes them.
   */
  async carryOn({ goals, meetings }: HandedOver) {
    for (const id of goals)
      await this.life(id, () => this.life(ACTIVATING, () => this.wake(this.goal(id))));
    for (const id of meetings) this.meetings.resume(id);
    this.core.changed();
    this.scheduler.pump();
  }

  /**
   * Deletes an archived goal for good: its subtasks' worktrees, branches and
   * records, its own worktree and its plans' documents, then its tasks, subtasks,
   * meetings and their questions. Its branch stays, yours to merge or delete.
   */
  delete(id: string): Promise<void> {
    return this.life(id, async () => {
      const { core } = this;
      const goal = core.state.goals.find((g) => g.id === id);
      // Gone already: what you asked for holds.
      if (!goal) return;
      if (!can(GOAL_MACHINE, goal.status, "delete"))
        throw new Error(`The goal "${goal.name}" isn't archived: archive it before deleting it`);
      const subtasks = core.state.subtasks.filter((s) => s.goalId === id);
      // A merge under way finishes first, and so does a meeting being cancelled.
      await this.scheduler.release(subtasks.map((s) => s.id));
      await this.meetings.settled(id);
      // Its files go first: should one fail, it stays archived, to delete again.
      await removeGoal(core.places, goal.slug);
      await Promise.all([
        ...core.state.meetings.flatMap((m) =>
          m.goalId === id && m.planFile ? [rm(m.planFile, { force: true })] : [],
        ),
        ...subtasks.map((s) => rm(recordFile(core.places, s.id), { force: true })),
      ]);
      const gone = new Set(subtasks.map((s) => s.id));
      const { state } = core;
      state.questions = state.questions.filter((q) => !q.subtaskId || !gone.has(q.subtaskId));
      state.subtasks = state.subtasks.filter((s) => s.goalId !== id);
      state.tasks = state.tasks.filter((t) => t.goalId !== id);
      state.meetings = state.meetings.filter((m) => m.goalId !== id);
      state.goals = state.goals.filter((g) => g.id !== id);
      core.changed();
    });
  }

  /**
   * Gives a member a subtask directly, as a task of its own. It starts once
   * they are free; a paused goal's waits for the goal to go on.
   */
  assign(goalId: string, work: DirectWork): Subtask[] {
    const goal = this.goal(goalId);
    if (goal.status === "archived")
      throw new Error(`The goal "${goal.name}" is archived: resume it first`);
    if (!this.core.team.members.some((m) => m.name === work.assignee))
      throw new Error(`There is no member called "${work.assignee}"`);
    return this.scheduler.assign(goal.id, [
      // Work you assign is done once merged: it isn't yours to accept (§7.1).
      {
        title: work.title,
        outcome: "",
        ownerAccepts: false,
        subtasks: [{ ...work, key: "", dependsOn: [] }],
      },
    ]);
  }

  /** Makes a goal active again; false when it was already. */
  private wake(goal: Goal): boolean {
    if (goal.status === "active") return false;
    this.onlyOne();
    goal.status = step(GOAL_MACHINE, goal.status, "resume");
    goal.archivedAt = undefined;
    return true;
  }

  /** One goal is active at a time (§4.1): one under way refuses another. */
  private onlyOne() {
    const active = this.core.state.goals.find((g) => g.status === "active");
    if (active)
      throw new Error(
        `The goal "${active.name}" [${active.id}] is under way, and one goal runs at a time: pause it first if the user wants`,
      );
  }

  private goal(id: string): Goal {
    const goal = this.core.state.goals.find((g) => g.id === id);
    if (!goal) throw new Error("There is no such goal");
    return goal;
  }

  /** Holds a goal's work, cancels its meeting under way and, `plansToo`, its plans in review. */
  private hold(goal: Goal, plansToo: boolean) {
    this.scheduler.hold(goal.id);
    for (const meeting of this.core.state.meetings) {
      if (meeting.goalId !== goal.id) continue;
      if (meeting.status === "running" || (plansToo && meeting.status === "review"))
        void this.meetings.cancel(meeting.id);
    }
    this.core.changed();
  }
}

/**
 * The scheduler (docs/design.md §4.3, §5): the only module that moves a
 * subtask (SUBTASK_MACHINE). It starts every subtask that can start (its
 * upstream merged, its member free, its goal active) in its own worktree,
 * has what is delivered reviewed when review is on, and merges it into the
 * goal's branch, one merge at a time.
 */
import { randomUUID } from "node:crypto";
import {
  busyMembers,
  canSendBack,
  forkOf,
  planned,
  reviewerOf,
  taskDone,
  waitsIn,
  upstreamOf,
} from "./derive.ts";
import { REFUSED, spend, workOf, type Core } from "./core.ts";
import { errorText } from "../shared/errors.ts";
import {
  abortMerge,
  commitDesk,
  dropDesk,
  GitError,
  mergeDesk,
  openDesk,
  pickSide,
  subtaskBranch,
} from "./git.ts";
import { actionEvent, can, step, SUBTASK_MACHINE, type SubtaskEvent } from "./machines.ts";
import { goOnMessage, taskBrief } from "./prompts.ts";
import { DOESNT_FIT, type DecisionAnswer, type Questions } from "./questions.ts";
import { runSubtask, type RunOutcome } from "./run.ts";
import { type Step } from "./turns.ts";
import {
  DECISIONS,
  type Decision,
  type Goal,
  type GoOn,
  type Member,
  type PlanSubtask,
  type PlanTask,
  type Progress,
  type Subtask,
  type SubtaskAction,
  type Task,
} from "./types.ts";
import { collaborationOf } from "./collaboration.ts";
import { reviewDelivery } from "./review.ts";

/** Sent back this many times, a delivery is yours to decide on. */
const REVIEW_ROUNDS = 3;

/** A subtask you give a member directly, without a meeting. */
type DirectWork = Omit<PlanSubtask, "key" | "dependsOn">;

/** One more reason for a subtask to go on in its session, after those it has. */
function goOnWith(subtask: Subtask, reason: GoOn) {
  subtask.goOn = [...(subtask.goOn ?? []), reason];
}

/** How far a member is, from their todo list. */
const progressOf = (steps: Step[]): Progress => {
  const current = steps.find((s) => s.status === "in_progress")?.content;
  return {
    done: steps.filter((s) => s.status === "completed").length,
    total: steps.length,
    ...(current !== undefined && { current }),
  };
};

/** The stages a subtask is taken up in: run, reviewed, merged. */
const TAKEN_UP: readonly Subtask["status"][] = ["pending", "reviewing", "merging"];

/** A subtask's stage under way: how to stop it, and when it has ended. */
interface Live {
  kind: "run" | "review" | "merge";
  abort: AbortController;
  ended: Promise<void>;
}

export class Scheduler {
  /** Subtask id → its stage under way. */
  private live = new Map<string, Live>();
  /** Closing: nothing starts. */
  private closed = false;
  /**
   * Runs stopped to go on in their sessions (their goal was paused, or you
   * added to them): they go back to pending with these, not to stopped.
   */
  private held = new Map<string, GoOn[]>();

  constructor(
    private readonly core: Core,
    private readonly questions: Questions,
  ) {}

  /** Stops everything under way and starts nothing after; settles once it has ended. */
  async close() {
    this.closed = true;
    for (const live of this.live.values()) live.abort.abort();
    await Promise.all([...this.live.values()].map((live) => live.ended));
  }

  /**
   * After a restart nothing is under way: what was running goes back to
   * pending, to go on in its session; what was in review or being merged is
   * taken up again by the next pump.
   */
  recover() {
    for (const subtask of this.core.state.subtasks) {
      if (subtask.status !== "running") continue;
      this.move(subtask, "hold");
      if (subtask.session) goOnWith(subtask, { why: "held" });
    }
  }

  /**
   * Gives the goal new work: tasks, each with its subtasks, their dependencies
   * by the keys they have in `tasks`. They wait as pending until they can
   * start. `meetingId`: the meeting whose plan they come from.
   */
  assign(tasks: readonly PlanTask[], meetingId?: string): Subtask[] {
    const { state } = this.core;
    const ids = new Map<string, string>();
    const added = tasks.flatMap(({ title, outcome, ownerAccepts, subtasks }) => {
      const task: Task = {
        id: randomUUID(),
        title,
        outcome,
        ownerAccepts,
        ...(meetingId !== undefined && { meetingId }),
      };
      state.tasks.push(task);
      return subtasks.map(({ key, ...planned }): Subtask => {
        const id = randomUUID();
        ids.set(key, id);
        return {
          ...planned,
          id,
          taskId: task.id,
          status: "pending",
          progress: { done: 0, total: 0 },
        };
      });
    });
    // Keys become ids once every subtask has one.
    for (const subtask of added)
      subtask.dependsOn = subtask.dependsOn.flatMap((k) => ids.get(k) ?? []);
    state.subtasks.push(...added);
    this.core.changed();
    this.pump();
    return added;
  }

  /**
   * Gives a member one subtask directly, as a task of its own: done once
   * merged, not yours to accept (§7.1). Throws when the goal has had its
   * planning (§2) or there is no such member.
   */
  assignOne(work: DirectWork): Subtask {
    const { goal } = this;
    if (goal.status === "archived") throw new Error(REFUSED.archived(goal));
    if (planned(this.core.state)) throw new Error(REFUSED.planned(goal));
    if (!this.core.team.members.some((m) => m.name === work.assignee))
      throw new Error(REFUSED.noMember(work.assignee));
    const [added] = this.assign([
      {
        title: work.title,
        outcome: "",
        ownerAccepts: false,
        subtasks: [{ ...work, key: "", dependsOn: [] }],
      },
    ]);
    if (!added) throw new Error("No subtask was made");
    return added;
  }

  /**
   * Puts the goal's work on hold (it was paused or archived): its runs stop, to
   * go on in their sessions when it is resumed; its reviews stop, to be done
   * again then. Nothing of it starts meanwhile; a merge under way finishes.
   */
  hold() {
    for (const subtask of this.core.state.subtasks) {
      const live = this.live.get(subtask.id);
      if (!live || live.kind === "merge") continue;
      if (live.kind === "run") this.keepOn(subtask.id, { why: "held" });
      live.abort.abort();
    }
  }

  /** The subtasks whose review or merge is under way now. */
  underWay(): string[] {
    return [...this.live].filter(([, live]) => live.kind !== "run").map(([id]) => id);
  }

  /**
   * Does what you asked to a subtask (§4.3): stop it, have it go on, or retry
   * it: the subtask, where that left it. Throws when there is no
   * such subtask, or when it can't be done where the subtask stands
   * (derive.ts actionsOf).
   */
  async act(subtaskId: string, action: SubtaskAction): Promise<Subtask> {
    const subtask = this.subtask(subtaskId);
    if (!subtask) throw new Error("There is no such subtask");
    const event = actionEvent(subtask.status, action);
    if (!event) throw new Error(`"${subtask.title}" can't ${action} while ${subtask.status}`);
    if (action === "continue") this.continue(subtask, event);
    else await this[action](subtask);
    return subtask;
  }

  /**
   * Lets go of work about to be deleted: what waits to start won't, what runs
   * or is reviewed stops, not to go on, and this settles once all of it under
   * way has ended (a merge finishes first), so nothing of it is written after.
   */
  async release(subtaskIds: string[]) {
    await Promise.all(
      subtaskIds.flatMap((id) => {
        this.held.delete(id);
        const live = this.live.get(id);
        const subtask = this.subtask(id);
        const stopping = subtask ? this.stop(subtask) : Promise.resolve();
        return live ? [live.ended, stopping] : [stopping];
      }),
    );
  }

  /**
   * You stop a subtask: one not started, a run (this waits until it has ended
   * as stopped), a review, a merge waiting on your decision (its half-done
   * merge undone). One handed over keeps its delivery and the stage it
   * stopped in, to go on from.
   */
  private async stop(subtask: Subtask) {
    const live = this.live.get(subtask.id);
    if (live?.kind === "run") {
      // Your stop wins over going on. Its run ends it as stopped, or as what it came to first.
      this.held.delete(subtask.id);
      live.abort.abort();
      await live.ended;
      return;
    }
    // Deleted work, stopped already: nothing to stop.
    if (!actionEvent(subtask.status, "stop")) return;
    // A merge under way finishes (stopMerge is only while it waits on you); that one is undone, its worktree back as delivered.
    if (subtask.status === "waitingInMerge") await abortMerge(this.core.places, subtask.id);
    // Stopped meanwhile: that stop did it.
    const event = actionEvent(subtask.status, "stop");
    if (!event) return;
    live?.abort.abort();
    this.move(subtask, event);
    subtask.finishedAt = Date.now();
    this.core.changed();
    this.pump();
  }

  /** You retry a failed or stopped subtask from the start: its session, delivery, review and worktree go. */
  private async retry(subtask: Subtask) {
    await dropDesk(this.core.places, subtask.id);
    // Retried meanwhile: that one did it.
    if (!can(SUBTASK_MACHINE, subtask.status, "retry")) return;
    this.move(subtask, "retry");
    Object.assign(subtask, {
      error: undefined,
      progress: { done: 0, total: 0 },
      session: undefined,
      goOn: undefined,
      delivery: undefined,
      review: undefined,
      conflict: undefined,
    });
    this.core.changed();
    this.pump();
  }

  /**
   * You have a failed or stopped subtask go on from where it stopped
   * (`event`, actionEvent): its session and worktree, or, stopped once handed
   * over, its review or merge, its delivery standing.
   */
  private continue(subtask: Subtask, event: SubtaskEvent) {
    this.move(subtask, event);
    subtask.error = undefined;
    if (event === "continue" && subtask.session) goOnWith(subtask, { why: "continued" });
    this.core.changed();
    this.pump();
  }

  /**
   * Answers a decision put to you (Questions.answer) and carries it out: on a
   * stuck review (review again, skip it, send it back), on a merge (keep one
   * side of the files that can't be merged line by line, or try again), on a
   * task done (accept it, which is all it takes for work built on it to
   * start; or send one of its subtasks, `sentBack` or else the last one done,
   * back with what to change). Throws as answering does, and when the
   * subtask sent back isn't one done in the task.
   */
  async decide(id: string, answer: DecisionAnswer) {
    const question = this.questions.find(id);
    if (question.kind !== "decision" || !canSendBack(this.core.state, question, answer.sentBack))
      throw new Error(DOESNT_FIT);
    this.questions.answer(id, answer);
    const subtask = this.subtask(question.subtaskId);
    if (!subtask) return;
    const { option: pick, note = "" } = answer;
    if (question.decision.kind === "delivery") {
      const sentBack = this.subtask(answer.sentBack ?? subtask.id);
      if (pick === "revise" && sentBack) {
        this.move(sentBack, "redo");
        goOnWith(sentBack, { why: "revised", note });
      }
    } else if (subtask.status === "waitingInReview") {
      // You decided: the count of times sent back starts over.
      subtask.review = { ...subtask.review, rounds: 0 };
      if (pick === "rereview") this.move(subtask, "rereview");
      else if (pick === "skip") this.move(subtask, "merge");
      else if (pick === "sendBack") {
        this.move(subtask, "reject");
        if (subtask.session) {
          const said = [subtask.review.notes, note && `The user adds: ${note}`];
          goOnWith(subtask, { why: "rejected", note: said.filter(Boolean).join("\n\n") });
        }
      }
    } else if (subtask.status === "waitingInMerge") {
      if (pick === "stop") await this.stop(subtask);
      else {
        if (pick === "retry") await abortMerge(this.core.places, subtask.id);
        else if (question.decision.kind === "conflict" && (pick === "ours" || pick === "theirs"))
          await pickSide(this.core.places, subtask.id, question.decision.files, pick);
        // Stopped meanwhile: that stop stands.
        if (can(SUBTASK_MACHINE, subtask.status, "remerge")) this.move(subtask, "remerge");
      }
    }
    this.core.changed();
    this.pump();
  }

  /**
   * Takes up whatever the rules leave waiting on nothing (derive.ts
   * waitsIn), one at a time: each start is seen by the next, its member
   * busy, its review or merge under way.
   */
  pump() {
    if (this.closed) return;
    for (;;) {
      const work = workOf(this.core);
      const busy = busyMembers(work);
      const next = work.subtasks.find(
        (s) =>
          !this.live.has(s.id) && TAKEN_UP.includes(s.status) && !waitsIn(work, s, busy).length,
      );
      if (!next) return;
      // Under way at once (begin), so the next look sees it.
      if (next.status === "pending") void this.startRun(next);
      else if (next.status === "reviewing") void this.startReview(next);
      else void this.startMerge(next);
    }
  }

  /** A review or merge waits on your decision: `text`, what it came to, if it says more. */
  private ask(subtask: Subtask, decision: Decision, text: string) {
    this.move(subtask, decision.kind === "review" ? "askReview" : "askMerge");
    this.questions.openDecision(subtask, decision, text);
  }

  /**
   * Moves a subtask by its machine. Leaving where it waits on you calls off
   * your decision on it; done again, its task's delivery waits until it is
   * done again.
   */
  private move(subtask: Subtask, event: SubtaskEvent) {
    const from = subtask.status;
    subtask.status = step(SUBTASK_MACHINE, from, event);
    if (from === "waitingInReview" || from === "waitingInMerge")
      this.questions.cancelFor(subtask.id, true);
    if (from === "done")
      this.questions.cancelDelivery(
        this.core.state.subtasks.filter((s) => s.taskId === subtask.taskId).map((s) => s.id),
      );
  }

  /** A run about to be stopped goes on in its session, with `reason` too. */
  private keepOn(subtaskId: string, reason: GoOn) {
    this.held.set(subtaskId, [...(this.held.get(subtaskId) ?? []), reason]);
  }

  private subtask(id: string): Subtask | undefined {
    return this.core.state.subtasks.find((s) => s.id === id);
  }

  private get goal(): Goal {
    return this.core.state.goal;
  }

  private taskOf(subtask: Subtask): Task {
    const task = this.core.state.tasks.find((t) => t.id === subtask.taskId);
    if (!task) throw new Error(`The task of "${subtask.title}" is gone`);
    return task;
  }

  /** The document of the approved plan a task came from, if it came from one. */
  private planOf(task: Task): string | undefined {
    return this.core.state.meetings.find((m) => m.id === task.meetingId)?.plan?.markdown;
  }

  /** A member by name, as the plan or `assign` checked it against the goal's team, which stays as it was (§6). */
  private memberOf(name: string): Member {
    const member = this.core.team.members.find((m) => m.name === name);
    if (!member) throw new Error(`${name} isn't on the goal's team`);
    return member;
  }

  /** Registers a stage under way; `end` settles its `ended`. */
  private begin(subtask: Subtask, kind: Live["kind"]) {
    const abort = new AbortController();
    const { promise: ended, resolve } = Promise.withResolvers<undefined>();
    this.live.set(subtask.id, { kind, abort, ended });
    return {
      abort,
      end: () => {
        this.live.delete(subtask.id);
        resolve(undefined);
      },
    };
  }

  /**
   * Runs a subtask in its worktree: from its brief, or in its last session
   * with why it goes on. A first run carrying on its member's own work forks
   * that work's session (§4.3). Delivered, its worktree is committed in its member's
   * name and it goes on to be merged.
   */
  private async startRun(subtask: Subtask) {
    const { core } = this;
    const { abort, end } = this.begin(subtask, "run");
    // What it goes on with in its last session; with none kept, your words for it go into the brief.
    const goOn = subtask.session ? subtask.goOn : undefined;
    const notes = goOn ? [] : (subtask.goOn ?? []);
    const fork = goOn ? undefined : forkOf(core.state, subtask);
    subtask.goOn = undefined;
    this.move(subtask, "start");
    subtask.startedAt = Date.now();
    subtask.finishedAt = undefined;
    core.changed();

    let outcome: RunOutcome | undefined;
    try {
      const member = this.memberOf(subtask.assignee);
      const { goal } = this;
      const task = this.taskOf(subtask);
      const desk = await openDesk(core.places, subtask.id);
      const recorder = core.recorder(subtask);
      outcome = await runSubtask({
        options: core.options(member, "work", desk),
        opening: goOn
          ? goOnMessage(goOn, subtask)
          : taskBrief({
              goal,
              task,
              subtask,
              cwd: desk,
              branch: subtaskBranch(goal.slug, subtask.id),
              plan: this.planOf(task),
              upstream: upstreamOf(core.state, subtask),
              notes,
              ...(fork && { forked: fork }),
            }),
        ...(goOn ? { resume: subtask.session } : fork && { resume: fork.session, fork: true }),
        gate: this.questions.gate({
          from: member.name,
          subtaskId: subtask.id,
          signal: abort.signal,
        }),
        collaboration: collaborationOf(core, this.questions, {
          from: member,
          subtask,
          desk,
          signal: abort.signal,
        }),
        listener: {
          ...recorder,
          session: (id, model) => {
            // Kept, for the next run to go on in.
            subtask.session = id;
            core.changed();
            recorder.session?.(id, model);
          },
          steps: (steps) => {
            subtask.progress = progressOf(steps);
            core.changed();
            recorder.steps?.(steps);
          },
        },
        signal: abort.signal,
      });
      if (outcome.status === "delivered")
        await commitDesk(
          core.places,
          subtask.id,
          member.name,
          `${subtask.title}\n\n${outcome.handover.summary}`,
        );
    } catch (error) {
      // Never left running: a worktree that can't be made, a commit that fails (the run's tokens still spent).
      outcome = { status: "failed", error: errorText(error), tokens: outcome?.tokens ?? 0 };
    }

    // Nothing waits on your answers any more.
    this.questions.cancelFor(subtask.id);
    end();
    spend(core.state, subtask.assignee, outcome.tokens);
    const held = this.held.get(subtask.id);
    this.held.delete(subtask.id);
    // Recorded even while closing, so a goal let go keeps how its runs ended. Held with its goal, it goes on if it stopped.
    if (held && outcome.status === "stopped") {
      this.move(subtask, "hold");
      for (const reason of held) goOnWith(subtask, reason);
    } else if (outcome.status === "delivered") {
      subtask.delivery = { ...outcome.handover, at: Date.now() };
      subtask.conflict = undefined;
      this.move(subtask, core.state.goal.settings.review ? "review" : "merge");
    } else {
      this.move(subtask, outcome.status === "failed" ? "fail" : "stop");
      if (outcome.status === "failed") subtask.error = outcome.error;
      subtask.finishedAt = Date.now();
    }
    core.changed();
    this.pump();
  }

  /**
   * Reviews a delivery: a read-only session of the reviewer's in the
   * subtask's worktree passes it on to be merged, or sends it back with
   * notes; the third time back, or when the review fails, you decide. Stopped
   * meanwhile, it leaves the subtask as it is.
   */
  private async startReview(subtask: Subtask) {
    const { core } = this;
    const { abort, end } = this.begin(subtask, "review");
    try {
      const reviewer = this.memberOf(reviewerOf(workOf(core), subtask));
      const { delivery } = subtask;
      if (!delivery) throw new Error(`"${subtask.title}" has no delivery to review`);
      const verdict = await reviewDelivery(core, {
        reviewer,
        task: this.taskOf(subtask),
        subtask,
        delivery,
        desk: await openDesk(core.places, subtask.id),
        signal: abort.signal,
      });
      if (subtask.status !== "reviewing") return;
      const rounds = (subtask.review?.rounds ?? 0) + (verdict.pass ? 0 : 1);
      subtask.review = { rounds, notes: verdict.notes };
      if (verdict.pass) this.move(subtask, "merge");
      // Its notes are in `review`, read from there.
      else if (rounds >= REVIEW_ROUNDS) this.ask(subtask, DECISIONS.stuckReview(), "");
      else {
        this.move(subtask, "reject");
        if (subtask.session) goOnWith(subtask, { why: "rejected", note: verdict.notes });
      }
    } catch (error) {
      if (abort.signal.aborted || subtask.status !== "reviewing") return;
      // The last review gave no word: earlier notes are no longer what it says.
      subtask.review = { rounds: subtask.review?.rounds ?? 0 };
      this.ask(subtask, DECISIONS.failedReview(), errorText(error));
    } finally {
      end();
      core.changed();
      this.pump();
    }
  }

  /**
   * Merges a delivery into its goal's branch. Clean, the subtask is done.
   * Text conflicts go back to its member, in their session and worktree;
   * files that can't be merged line by line, or git failing, wait on your
   * decision.
   */
  private async startMerge(subtask: Subtask) {
    const { core } = this;
    const { end } = this.begin(subtask, "merge");
    try {
      // Git failing is put to you; anything else is a bug, and goes on up.
      const merged = await mergeDesk(core.places, subtask.id, subtask.assignee).catch(
        (error: unknown) => {
          if (error instanceof GitError) return error;
          throw error;
        },
      );
      if (merged instanceof GitError) this.ask(subtask, DECISIONS.failedMerge(), errorText(merged));
      else if (merged.kind === "merged") {
        this.move(subtask, "merged");
        subtask.conflict = undefined;
        this.finished(subtask);
      } else if (merged.other.length) {
        this.ask(subtask, DECISIONS.mergeFiles(merged.other), "");
      } else {
        this.move(subtask, "conflict");
        subtask.conflict = { files: merged.text };
        if (subtask.session) goOnWith(subtask, { why: "conflict" });
      }
    } finally {
      end();
      core.changed();
      this.pump();
    }
  }

  /**
   * A subtask merged: done. The last of its task, the task is done: one you
   * accept waits for your acceptance.
   */
  private finished(subtask: Subtask) {
    subtask.finishedAt = Date.now();
    subtask.progress = { done: subtask.progress.total, total: subtask.progress.total };
    if (!taskDone(this.core.state, subtask.taskId) || !this.taskOf(subtask).ownerAccepts) return;
    this.questions.openDecision(subtask, DECISIONS.delivery(), this.taskOf(subtask).title);
  }
}

/**
 * The scheduler (docs/design.md §4.3, §5): the only module that moves a
 * subtask (SUBTASK_MACHINE). It starts every subtask that can start (its
 * upstream merged, its member free, its goal active) in its own worktree,
 * has what is delivered reviewed when review is on, and merges it into the
 * goal's branch, one merge at a time.
 */
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { busyMembers, redoneUpstream, reviewerOf, waitsIn } from "./derive.ts";
import { errorText, workOf, type Core } from "./core.ts";
import {
  abortMerge,
  commitDesk,
  dropDesk,
  memberSigner,
  mergeDesk,
  openDesk,
  openGoal,
  pickSide,
  subtaskBranch,
  unresolved,
} from "./git.ts";
import { can, step, SUBTASK_MACHINE } from "./machines.ts";
import {
  goOnMessage,
  reviewPrompt,
  taskBrief,
  teammateQuestion,
  type Upstream,
} from "./prompts.ts";
import type { Answer, Questions } from "./questions.ts";
import { runSubtask, type RunOutcome } from "./run.ts";
import { askOnce, type Step } from "./turns.ts";
import type {
  DecisionOption,
  Goal,
  GoOn,
  Member,
  PlanTask,
  Progress,
  Question,
  Subtask,
  Task,
} from "./types.ts";

/** A reviewer's verdict on a delivery. */
const verdictSchema = z.object({ pass: z.boolean(), notes: z.string().trim() });

/** Sent back this many times, a delivery is yours to decide on. */
const REVIEW_ROUNDS = 3;

/** Your calls on a stuck review, a merge with files that can't be merged line by line, and a task done. */
const REVIEW_CALLS: DecisionOption[] = ["rereview", "skip", "sendBack"];
const SIDE_CALLS: DecisionOption[] = ["ours", "theirs", "retry"];
const DELIVERY_CALLS: DecisionOption[] = ["accept", "revise"];

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

/** When a subtask in review or being merged was delivered; the rest keep their order. */
const handedAt = (subtask: Subtask) =>
  subtask.status === "reviewing" || subtask.status === "merging" ? (subtask.delivery?.at ?? 0) : 0;

/** A subtask's stage under way: how to stop it, and when it has ended. */
interface Live {
  kind: "run" | "review" | "merge";
  abort: AbortController;
  ended: Promise<void>;
}

export class Scheduler {
  /** Subtask id → its stage under way. */
  private live = new Map<string, Live>();
  /** Closing: nothing starts, and what stopped work still reports goes nowhere. */
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
    const now = Date.now();
    const ids = new Map<string, string>();
    const added = tasks.flatMap(({ title, outcome, ownerAccepts, subtasks }) => {
      const task: Task = {
        id: randomUUID(),
        title,
        outcome,
        ownerAccepts,
        createdAt: now,
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
          createdAt: now,
          progress: { done: 0, total: 0 },
          tokens: 0,
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

  /**
   * You add to a subtask (a message to its member): it goes on in its
   * session, from where it stopped, with `note`; a running one stops first,
   * one not started yet hears it in its brief. One being reviewed or merged
   * is handed over already, and the work of a paused or archived goal waits for
   * the goal to be resumed. Throws when there is no such subtask.
   */
  carry(subtaskId: string, note: string): "goes" | "handedOver" | "onHold" {
    const subtask = this.subtask(subtaskId);
    if (!subtask) throw new Error("There is no such subtask");
    if (this.goal.status !== "active") return "onHold";
    if (subtask.status === "reviewing" || subtask.status === "merging") return "handedOver";
    const live = this.live.get(subtaskId);
    if (live) {
      this.keepOn(subtaskId, { why: "carried", note });
      live.abort.abort();
      return "goes";
    }
    if (subtask.status === "failed" || subtask.status === "stopped") this.move(subtask, "continue");
    else if (subtask.status === "done") this.move(subtask, "redo");
    goOnWith(subtask, { why: "carried", note });
    subtask.error = undefined;
    this.core.changed();
    this.pump();
    return "goes";
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
        const stopping = this.stop(id);
        return live ? [live.ended, stopping] : [stopping];
      }),
    );
  }

  /**
   * You stop a subtask: one not started, a run (it ends as stopped), a
   * review, a merge waiting on your decision (its half-done merge undone). One
   * handed over keeps its delivery and the stage it stopped in, to go on from.
   */
  async stop(subtaskId: string) {
    const subtask = this.subtask(subtaskId);
    const live = this.live.get(subtaskId);
    if (live?.kind === "run") {
      // Your stop wins over going on.
      this.held.delete(subtaskId);
      live.abort.abort();
      return;
    }
    if (!subtask || !can(SUBTASK_MACHINE, subtask.status, "stop")) return;
    if (subtask.status === "merging") {
      // A merge under way finishes; one waiting on you is undone, its worktree back as delivered.
      if (live) return;
      await abortMerge(this.core.places, this.goal.slug, subtask.id);
      // Stopped meanwhile: that stop did it.
      if (!can(SUBTASK_MACHINE, subtask.status, "stop")) return;
    }
    live?.abort.abort();
    const stage = subtask.status;
    this.move(subtask, "stop");
    if (stage === "reviewing" || stage === "merging") subtask.stoppedIn = stage;
    subtask.finishedAt = Date.now();
    this.core.changed();
    this.pump();
  }

  /** You retry a failed or stopped subtask from the start: its session, delivery, review and worktree go. */
  async retry(subtaskId: string) {
    const subtask = this.subtask(subtaskId);
    if (!subtask || !can(SUBTASK_MACHINE, subtask.status, "retry")) return;
    await dropDesk(this.core.places, this.goal.slug, subtask.id);
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
   * You have a failed or stopped subtask go on from where it stopped: its
   * session and worktree, or, stopped once handed over, its review or merge,
   * its delivery standing.
   */
  continue(subtaskId: string) {
    const subtask = this.subtask(subtaskId);
    if (!subtask || !can(SUBTASK_MACHINE, subtask.status, "continue")) return;
    const stage = subtask.stoppedIn;
    this.move(
      subtask,
      stage === "reviewing" ? "reviewAgain" : stage === "merging" ? "mergeAgain" : "continue",
    );
    subtask.error = undefined;
    if (!stage && subtask.session) goOnWith(subtask, { why: "continued" });
    this.core.changed();
    this.pump();
  }

  /** You redo a done subtask whose upstream was redone since: in its session, from the goal's branch. */
  redo(subtaskId: string) {
    const subtask = this.subtask(subtaskId);
    if (!subtask || !can(SUBTASK_MACHINE, subtask.status, "redo")) return;
    const redone = redoneUpstream(this.core.state, subtask).map((s) => s.title);
    this.move(subtask, "redo");
    if (subtask.session) goOnWith(subtask, { why: "redo", note: redone.join(", ") });
    this.core.changed();
    this.pump();
  }

  /**
   * Carries out your decision, answered already (Questions.answer): on a
   * stuck review (review again, skip it, send it back), on a merge (keep one
   * side of the files that can't be merged line by line, or try again), on a
   * task done (accept it, which is all it takes for work built on it to
   * start; or send one of its subtasks, `sentBack` or else the last one done,
   * back with what to change).
   */
  async decide(
    question: Extract<Question, { kind: "decision" }>,
    answer: Extract<Answer, { decision: DecisionOption }>,
  ) {
    const subtask = this.subtask(question.subtaskId ?? "");
    if (!subtask) return;
    const { decision: pick, note = "" } = answer;
    if (question.decision.kind === "delivery") {
      const sentBack = this.subtask(answer.sentBack ?? subtask.id);
      if (pick === "revise" && sentBack) {
        this.move(sentBack, "redo");
        goOnWith(sentBack, { why: "revised", note });
      }
    } else if (subtask.status === "reviewing") {
      // You decided: the count of times sent back starts over.
      subtask.review = { ...subtask.review, rounds: 0 };
      if (pick === "skip") this.move(subtask, "merge");
      else if (pick === "sendBack") {
        this.move(subtask, "reject");
        if (subtask.session) {
          goOnWith(subtask, { why: "rejected", note: subtask.review.notes ?? "" });
          if (note) goOnWith(subtask, { why: "carried", note });
        }
      }
    } else if (subtask.status === "merging") {
      const { slug } = this.goal;
      if (pick === "retry") await abortMerge(this.core.places, slug, subtask.id);
      else if (pick === "ours" || pick === "theirs")
        await pickSide(this.core.places, slug, subtask.id, question.decision.files ?? [], pick);
    }
    this.core.changed();
    this.pump();
  }

  /**
   * Takes up whatever can go on: what goes on in its session first, then new
   * work, and delivered work reviewed and merged in the order it was
   * delivered. A pending subtask starts, and one in review is reviewed, when
   * nothing holds it up (waitsIn: its goal active, you not deciding about it,
   * its member or reviewer free); one being merged is merged unless you are
   * deciding about it, one at a time.
   */
  pump() {
    if (this.closed) return;
    const { state } = this.core;
    const work = workOf(this.core);
    const busy = busyMembers(work);
    // One review each: those under way and those this pump starts.
    const reviews = new Set(
      state.subtasks
        .filter((s) => this.live.get(s.id)?.kind === "review")
        .map((s) => reviewerOf(work, s)),
    );
    let merging = state.subtasks.some((s) => this.live.get(s.id)?.kind === "merge");
    const order = [...state.subtasks].sort(
      (a, b) => Number(Boolean(b.goOn)) - Number(Boolean(a.goOn)) || handedAt(a) - handedAt(b),
    );
    for (const subtask of order) {
      if (this.live.has(subtask.id)) continue;
      if (subtask.status === "pending") {
        if (waitsIn(work, subtask, busy).length) continue;
        busy.add(subtask.assignee);
        void this.startRun(subtask);
      } else if (subtask.status === "reviewing") {
        const reviewer = reviewerOf(work, subtask);
        if (reviews.has(reviewer) || waitsIn(work, subtask, busy).length) continue;
        reviews.add(reviewer);
        void this.startReview(subtask);
      } else if (subtask.status === "merging") {
        if (waitsIn(work, subtask, busy).length || merging) continue;
        merging = true;
        void this.startMerge(subtask);
      }
    }
  }

  /**
   * Moves a subtask by its machine. Leaving review or a merge calls off your
   * decision on it; done again, its task's delivery waits until it is done
   * again; leaving where it stopped, where it was handed over stands no more.
   */
  private move(subtask: Subtask, event: keyof typeof SUBTASK_MACHINE) {
    const from = subtask.status;
    subtask.status = step(SUBTASK_MACHINE, from, event);
    if ((from === "reviewing" || from === "merging") && subtask.status !== from)
      this.questions.cancelFor(subtask.id, true);
    if (from === "done") this.questions.cancelDelivery(subtask.taskId);
    if (from === "stopped") subtask.stoppedIn = undefined;
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

  /** A member by name: one taken off the team since can't work or review. */
  private memberOf(name: string): Member {
    const member = this.core.team.members.find((m) => m.name === name);
    if (!member) throw new Error(`${name} is no longer on the team`);
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

  /** The work a subtask builds on, up the chain of dependencies: what it depends on directly first. */
  private upstreamOf(subtask: Subtask): Upstream[] {
    const { subtasks } = this.core.state;
    const chain: Upstream[] = [];
    const seen = new Set([subtask.id]);
    let level = subtask.dependsOn;
    for (let direct = true; level.length; direct = false) {
      const next: string[] = [];
      for (const id of level) {
        const done = subtasks.find((s) => s.id === id);
        if (!done || seen.has(id)) continue;
        seen.add(id);
        chain.push({ subtask: done, direct });
        next.push(...done.dependsOn);
      }
      level = next;
    }
    return chain;
  }

  /**
   * Runs a subtask in its worktree: from its brief, or in its last session
   * with why it goes on. Delivered, its worktree is committed in its member's
   * name and it goes on to be merged.
   */
  private async startRun(subtask: Subtask) {
    const { core } = this;
    const { abort, end } = this.begin(subtask, "run");
    // What it goes on with in its last session; with none kept, your words for it go into the brief.
    const goOn = subtask.session ? subtask.goOn : undefined;
    const notes = goOn ? [] : (subtask.goOn ?? []);
    subtask.goOn = undefined;
    this.move(subtask, "start");
    subtask.startedAt = Date.now();
    subtask.finishedAt = undefined;
    core.changed();

    let outcome: RunOutcome;
    try {
      const member = this.memberOf(subtask.assignee);
      const { goal } = this;
      const task = this.taskOf(subtask);
      const desk = await openDesk(core.places, goal.slug, subtask.id);
      const recorder = core.recorder(subtask);
      outcome = await runSubtask({
        options: core.options(member, "task", desk),
        opening: goOn
          ? goOnMessage(goOn, subtask)
          : taskBrief({
              goal,
              task,
              subtask,
              cwd: desk,
              branch: subtaskBranch(goal.slug, subtask.id),
              plan: this.planOf(task),
              upstream: this.upstreamOf(subtask),
              notes,
            }),
        ...(goOn && { resume: subtask.session }),
        gate: this.questions.gate({
          from: member.name,
          subtaskId: subtask.id,
          signal: abort.signal,
        }),
        collaboration: {
          askTeammate: (name, question) =>
            this.askTeammate(member, subtask, name, question, abort.signal),
          checkDelivery: (files) => this.checkDelivery(subtask, desk, files),
        },
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
          goal.slug,
          subtask.id,
          memberSigner(member.name),
          `${subtask.title}\n\n${outcome.handover.summary}`,
        );
    } catch (error) {
      // Never left running: a worktree that can't be made, a commit that fails.
      outcome = { status: "failed", error: errorText(error), tokens: 0 };
    }

    // Nothing waits on your answers any more.
    this.questions.cancelFor(subtask.id);
    end();
    subtask.tokens += outcome.tokens;
    const held = this.held.get(subtask.id);
    this.held.delete(subtask.id);
    if (this.closed) return;
    // Held with its goal, it goes on if it stopped; added to by you, even if it delivered just before.
    if (held && (outcome.status === "stopped" || held.some((g) => g.why === "carried"))) {
      this.move(subtask, "hold");
      for (const reason of held) goOnWith(subtask, reason);
    } else if (outcome.status === "delivered") {
      subtask.delivery = { ...outcome.handover, at: Date.now() };
      subtask.conflict = undefined;
      this.move(subtask, core.team.review ? "review" : "merge");
    } else {
      this.move(subtask, outcome.status === "failed" ? "fail" : "stop");
      if (outcome.status === "failed") subtask.error = outcome.error;
      subtask.finishedAt = Date.now();
    }
    core.changed();
    this.pump();
  }

  /**
   * A running member asks a teammate by name; the teammate answers in a
   * read-only session in the goal's worktree. What the asker is told.
   */
  private async askTeammate(
    from: Member,
    subtask: Subtask,
    name: string,
    question: string,
    signal: AbortSignal,
  ): Promise<string> {
    const { core } = this;
    const others = core.team.members.filter((m) => m.name !== from.name);
    const target = others.find((m) => m.name === name.trim());
    if (!target)
      return name.trim() === from.name
        ? "That's you; no need to ask."
        : `There's no teammate called "${name}". Your teammates: ${others.map((m) => m.name).join(", ") || "none"}.`;
    try {
      const reply = await this.questions.toTeammate(
        { from: from.name, subtaskId: subtask.id },
        target.name,
        question,
        async () =>
          askOnce({
            prompt: teammateQuestion({
              from,
              subtask,
              question,
              own: core.state.subtasks.filter((s) => s.assignee === target.name),
            }),
            options: core.options(target, "answer", await openGoal(core.places, this.goal.slug)),
            signal,
          }),
      );
      subtask.tokens += reply.tokens;
      core.changed();
      return `${target.name} answered: ${reply.text}`;
    } catch (error) {
      return `${target.name} couldn't answer just now: ${errorText(error)}`;
    }
  }

  /**
   * Whether a delivery is taken: every file is in the worktree, and the
   * conflicts a merge left are resolved. Its files as kept, or why not.
   */
  private async checkDelivery(subtask: Subtask, desk: string, files: string[]) {
    const kept: string[] = [];
    const missing: string[] = [];
    for (const file of files) {
      const relative = path.relative(desk, path.resolve(desk, file));
      const inside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
      const there =
        inside &&
        (await stat(path.join(desk, relative)).then(
          (found) => found.isFile(),
          () => false,
        ));
      if (there) kept.push(relative.split(path.sep).join("/"));
      else missing.push(file);
    }
    if (missing.length)
      return {
        refused: `Not delivered: these aren't files in your worktree (${desk}): ${missing.join(", ")}. Deliver the files that are there.`,
      };
    const left = subtask.conflict
      ? await unresolved(this.core.places, subtask.id, subtask.conflict.files)
      : [];
    if (left.length)
      return {
        refused: `Not delivered: conflict markers are still in ${left.join(", ")}. Resolve them first, keeping what both sides meant, then deliver.`,
      };
    return { files: [...new Set(kept)] };
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
      const desk = await openDesk(core.places, this.goal.slug, subtask.id);
      const reply = await askOnce({
        prompt: reviewPrompt({
          task: this.taskOf(subtask),
          subtask,
          delivery,
          cwd: desk,
        }),
        options: core.options(reviewer, "review", desk),
        schema: verdictSchema,
        signal: abort.signal,
      });
      subtask.tokens += reply.tokens;
      if (subtask.status !== "reviewing") return;
      const verdict = verdictSchema.parse(reply.structured);
      const rounds = (subtask.review?.rounds ?? 0) + (verdict.pass ? 0 : 1);
      subtask.review = { rounds, notes: verdict.notes };
      if (verdict.pass) this.move(subtask, "merge");
      else if (rounds >= REVIEW_ROUNDS)
        this.questions.openDecision(
          subtask,
          { kind: "review", options: REVIEW_CALLS },
          verdict.notes,
        );
      else {
        this.move(subtask, "reject");
        if (subtask.session) goOnWith(subtask, { why: "rejected", note: verdict.notes });
      }
    } catch (error) {
      if (abort.signal.aborted || subtask.status !== "reviewing") return;
      this.questions.openDecision(
        subtask,
        { kind: "review", options: REVIEW_CALLS },
        errorText(error),
      );
    } finally {
      end();
      if (!this.closed) {
        core.changed();
        this.pump();
      }
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
      const { goal } = this;
      const merged = await mergeDesk(
        core.places,
        goal.slug,
        subtask.id,
        memberSigner(subtask.assignee),
      );
      if (merged.kind === "merged") {
        this.move(subtask, "merged");
        subtask.conflict = undefined;
        this.finished(subtask);
      } else if (merged.other.length) {
        this.questions.openDecision(
          subtask,
          { kind: "merge", options: SIDE_CALLS, files: merged.other },
          merged.other.join("\n"),
        );
      } else {
        this.move(subtask, "conflict");
        subtask.conflict = { files: merged.text };
        if (subtask.session) goOnWith(subtask, { why: "conflict" });
      }
    } catch (error) {
      this.questions.openDecision(subtask, { kind: "merge", options: ["retry"] }, errorText(error));
    } finally {
      end();
      if (!this.closed) {
        core.changed();
        this.pump();
      }
    }
  }

  /**
   * A subtask merged: done. The last of its task, the task is done: one you
   * accept waits for your acceptance.
   */
  private finished(subtask: Subtask) {
    subtask.finishedAt = Date.now();
    subtask.progress = { done: subtask.progress.total, total: subtask.progress.total };
    if (this.core.state.subtasks.some((s) => s.taskId === subtask.taskId && s.status !== "done"))
      return;
    if (!this.taskOf(subtask).ownerAccepts) return;
    this.questions.openDecision(
      subtask,
      { kind: "delivery", options: DELIVERY_CALLS },
      this.taskOf(subtask).title,
    );
  }
}

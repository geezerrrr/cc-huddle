/**
 * The scheduler (docs/design.md §4.3, §5): the only module that moves a
 * subtask (SUBTASK_MACHINE). It starts every subtask that can start (its
 * upstream merged, its member free, its goal active) in its own worktree,
 * and merges what is delivered into the goal's branch, one merge at a time
 * per goal.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { busyMembers, waitsIn } from "./derive.ts";
import { errorText, workOf, type Core } from "./core.ts";
import {
  commitDesk,
  memberSigner,
  mergeDesk,
  openDesk,
  openGoal,
  subtaskBranch,
  unresolved,
} from "./git.ts";
import { step, SUBTASK_MACHINE } from "./machines.ts";
import { goOnMessage, taskBrief, teammateQuestion, type Upstream } from "./prompts.ts";
import type { Questions } from "./questions.ts";
import { runSubtask, type RunOutcome } from "./run.ts";
import { askOnce, type Step } from "./turns.ts";
import type { DecisionOption, Goal, GoOn, Member, Progress, Subtask, Task } from "./types.ts";

/** Your calls on a merge with files that can't be merged line by line, and on a task done. */
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

/** When a subtask being merged was delivered; the rest keep their order. */
const handedAt = (subtask: Subtask) =>
  subtask.status === "merging" ? (subtask.delivery?.at ?? 0) : 0;

/** A subtask's stage under way: how to stop it, and when it has ended. */
interface Live {
  kind: "run" | "merge";
  abort: AbortController;
  ended: Promise<void>;
}

export class Scheduler {
  /** Subtask id → its stage under way. */
  private live = new Map<string, Live>();
  /** Closing: nothing starts, and what stopped work still reports goes nowhere. */
  private closed = false;

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
   * Takes up whatever can go on: what goes on in its session first, then new
   * work, and delivered work merged in the order it was delivered. A pending
   * subtask starts when nothing holds it up (waitsIn); one being merged is
   * merged unless you are deciding about it, one at a time per goal.
   */
  pump() {
    if (this.closed) return;
    const { state } = this.core;
    const work = workOf(this.core);
    const busy = busyMembers(work);
    const merging = new Set(
      state.subtasks.filter((s) => this.live.get(s.id)?.kind === "merge").map((s) => s.goalId),
    );
    const order = [...state.subtasks].sort(
      (a, b) => Number(Boolean(b.goOn)) - Number(Boolean(a.goOn)) || handedAt(a) - handedAt(b),
    );
    for (const subtask of order) {
      if (this.live.has(subtask.id)) continue;
      if (subtask.status === "pending") {
        if (waitsIn(work, subtask, busy).length) continue;
        busy.add(subtask.assignee);
        void this.startRun(subtask);
      } else if (subtask.status === "merging") {
        if (waitsIn(work, subtask, busy).length || merging.has(subtask.goalId)) continue;
        merging.add(subtask.goalId);
        void this.startMerge(subtask);
      }
    }
  }

  /** Moves a subtask by its machine. Leaving a merge calls off your decision on it. */
  private move(subtask: Subtask, event: keyof typeof SUBTASK_MACHINE) {
    const from = subtask.status;
    subtask.status = step(SUBTASK_MACHINE, from, event);
    if (from === "merging" && subtask.status !== from) this.questions.cancelFor(subtask.id, true);
  }

  private goalOf(subtask: Subtask): Goal {
    const goal = this.core.state.goals.find((g) => g.id === subtask.goalId);
    if (!goal) throw new Error(`The goal of "${subtask.title}" is gone`);
    return goal;
  }

  private taskOf(subtask: Subtask): Task {
    const task = this.core.state.tasks.find((t) => t.id === subtask.taskId);
    if (!task) throw new Error(`The task of "${subtask.title}" is gone`);
    return task;
  }

  /** The member a subtask is assigned to: one taken off the team since can't run it. */
  private memberOf(subtask: Subtask): Member {
    const member = this.core.team.members.find((m) => m.name === subtask.assignee);
    if (!member) throw new Error(`${subtask.assignee} is no longer on the team`);
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
    // What it goes on with in its last session; with none kept, what you asked for goes into the brief.
    const goOn = subtask.session ? subtask.goOn : undefined;
    const revision = goOn
      ? ""
      : (subtask.goOn ?? [])
          .filter((g) => g.why === "revised")
          .map((g) => g.note)
          .join("\n\n");
    subtask.goOn = undefined;
    this.move(subtask, "start");
    subtask.startedAt = Date.now();
    subtask.finishedAt = undefined;
    core.changed();

    let outcome: RunOutcome;
    try {
      const member = this.memberOf(subtask);
      const goal = this.goalOf(subtask);
      const desk = await openDesk(core.places, goal.slug, subtask.id);
      const recorder = core.recorder(subtask);
      outcome = await runSubtask({
        options: await core.options(member, "task", desk),
        opening: goOn
          ? goOnMessage(goOn, subtask)
          : taskBrief({
              goal,
              task: this.taskOf(subtask),
              subtask,
              cwd: desk,
              branch: subtaskBranch(goal.slug, subtask.id),
              upstream: this.upstreamOf(subtask),
              ...(revision && { revision }),
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
    if (this.closed) return;
    if (outcome.status === "delivered") {
      subtask.delivery = { ...outcome.handover, at: Date.now() };
      subtask.conflict = undefined;
      this.move(subtask, "merge");
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
              own: core.state.subtasks.filter(
                (s) => s.goalId === subtask.goalId && s.assignee === target.name,
              ),
            }),
            options: await core.options(
              target,
              "answer",
              await openGoal(core.places, this.goalOf(subtask).slug),
            ),
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
   * Merges a delivery into its goal's branch. Clean, the subtask is done.
   * Text conflicts go back to its member, in their session and worktree;
   * files that can't be merged line by line, or git failing, wait on your
   * decision.
   */
  private async startMerge(subtask: Subtask) {
    const { core } = this;
    const { end } = this.begin(subtask, "merge");
    try {
      const goal = this.goalOf(subtask);
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

  /** A subtask merged: done. The last of its task, the task's delivery waits for your acceptance. */
  private finished(subtask: Subtask) {
    subtask.finishedAt = Date.now();
    subtask.progress = { done: subtask.progress.total, total: subtask.progress.total };
    if (this.core.state.subtasks.some((s) => s.taskId === subtask.taskId && s.status !== "done"))
      return;
    this.questions.openDecision(
      subtask,
      { kind: "delivery", options: DELIVERY_CALLS },
      this.taskOf(subtask).title,
    );
  }
}

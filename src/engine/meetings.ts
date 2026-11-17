/**
 * Planning meetings (docs/design.md §4.2): the meetings' state machine
 * (MEETING_MACHINE), and their life: calling one, going on with one that
 * stopped, cancelling, and the plan in review, changed and approved. The
 * talk itself is meeting-run.ts.
 */
import { randomUUID } from "node:crypto";

import { errorText } from "../shared/errors.ts";
import { writeWhole } from "../shared/files.ts";
import { goalFiles } from "../shared/layout.ts";
import { REFUSED, workOf, type Core } from "./core.ts";
import { meetingResumes, planned } from "./derive.ts";
import { openGoal } from "./git.ts";
import { can, MEETING_MACHINE, step } from "./machines.ts";
import { MeetingRun } from "./meeting-run.ts";
import { soundPlan, type WrittenPlan } from "./plan.ts";
import type { Scheduler } from "./scheduler.ts";
import type { Meeting, MeetingNow, MeetingSize, Plan, Subtask } from "./types.ts";

/**
 * What calling a meeting takes: what to plan, its size, who
 * attends, the host first, and whether the host only runs it.
 */
interface MeetingCall {
  agenda: string;
  size: MeetingSize;
  /** Everyone, when empty. */
  attendees: string[];
  hostOnly?: boolean;
}

/** A meeting under way: how to stop it, when it has ended, and what goes on at it. */
interface Live {
  abort: AbortController;
  ended: Promise<void>;
  now: MeetingNow;
}

export class Meetings {
  /** Meeting id → its run under way. */
  private live = new Map<string, Live>();

  constructor(
    private readonly core: Core,
    private readonly scheduler: Scheduler,
  ) {}

  /** Calls a meeting, or throws why it can't be held now. */
  start(call: MeetingCall): Meeting {
    const { core } = this;
    if (planned(core.state)) throw new Error(REFUSED.planned(core.state.goal));
    const named = [...new Set(call.attendees)];
    const attendees = named.length
      ? named
      : core.team.members.map((m) => m.name).sort((a, b) => a.localeCompare(b));
    const participants = this.admit(attendees);
    if (call.hostOnly && participants.length < 2)
      throw new Error(`${participants[0]} can't only run a meeting with nobody else at it`);
    const meeting: Meeting = {
      id: randomUUID(),
      agenda: call.agenda,
      size: call.size,
      participants,
      ...(call.hostOnly && { hostOnly: true }),
      status: "running",
      turns: [],
    };
    core.state.meetings.push(meeting);
    core.changed();
    this.track(meeting);
    return meeting;
  }

  /** Goes on with a stopped meeting from where it stopped, on the terms of calling one. */
  resume(id: string) {
    const { core } = this;
    const meeting = core.state.meetings.find((m) => m.id === id);
    if (!meeting || !meetingResumes(workOf(core), meeting))
      throw new Error(
        "That meeting can't go on: only one stopped before its plan can, in an active goal",
      );
    this.admit(meeting.participants);
    meeting.status = step(MEETING_MACHINE, meeting.status, "resume");
    meeting.error = undefined;
    core.changed();
    this.track(meeting);
  }

  /**
   * Drops a plan in review at once, or stops a meeting under way: it is
   * cancelled as its run ends, which this waits for. Throws when there is no
   * such meeting, or it is over.
   */
  async cancel(id: string): Promise<void> {
    const meeting = this.core.state.meetings.find((m) => m.id === id);
    if (!meeting) throw new Error("There is no such meeting");
    if (can(MEETING_MACHINE, meeting.status, "drop")) {
      meeting.status = step(MEETING_MACHINE, meeting.status, "drop");
      this.core.changed();
      return;
    }
    if (!can(MEETING_MACHINE, meeting.status, "cancel"))
      throw new Error(`The meeting is ${meeting.status}: there is nothing to cancel`);
    const live = this.live.get(id);
    live?.abort.abort();
    await live?.ended;
  }

  /**
   * Your changes to a plan under review: `plan` is the whole plan, which may
   * give work to any member and names the tasks you accept, as the
   * change_plan tool took it (planSchema). Dependencies that loop are refused.
   */
  change(id: string, plan: WrittenPlan) {
    const { meeting } = this.underReview(id, "change");
    meeting.plan = soundPlan(plan, "refuse");
    this.core.changed();
  }

  /**
   * Approves a plan under review: its document is saved in the goal's folder,
   * and its tasks and subtasks go to the scheduler, pending until they can
   * start. Returns the subtasks.
   */
  async approve(id: string): Promise<Subtask[]> {
    const { core } = this;
    const { meeting, plan } = this.underReview(id, "approve");
    this.activeGoal();
    const file = goalFiles(core.places.root).plan(meeting.id);
    await writeWhole(file, plan.markdown);
    // Changed, called off or approved meanwhile, or its goal held: not approved now (the file stays).
    if (meeting.plan !== plan || !can(MEETING_MACHINE, meeting.status, "approve"))
      throw new Error("The plan changed while it was being approved");
    this.activeGoal();
    meeting.status = step(MEETING_MACHINE, meeting.status, "approve");
    return this.scheduler.assign(plan.tasks, meeting.id);
  }

  /** What goes on at each meeting under way, by its id. */
  now(): Record<string, MeetingNow> {
    return Object.fromEntries([...this.live].map(([id, live]) => [id, live.now]));
  }

  /** Settles once no meeting is under way: one being cancelled has ended. */
  async settled() {
    await Promise.all([...this.live.values()].map((live) => live.ended));
  }

  /** Stops every meeting under way, as cancelled; settles once they have ended. */
  async close() {
    for (const live of this.live.values()) live.abort.abort();
    await this.settled();
  }

  /** After a restart no meeting is under way: one that was is cancelled, to go on from where it was. */
  recover() {
    for (const meeting of this.core.state.meetings)
      if (meeting.status === "running")
        meeting.status = step(MEETING_MACHINE, meeting.status, "cancel");
  }

  /**
   * Whether these members can sit down together now: the goal
   * is active, each is on the team and free. Throws why not; gives them, the
   * first hosting. Nothing is
   * awaited here or before the meeting is under way, so two meetings can't
   * both take the same member.
   */
  private admit(attendees: readonly string[]): [string, ...string[]] {
    const { core } = this;
    this.activeGoal();
    const [host, ...rest] = attendees;
    if (host === undefined) throw new Error("The team has no members");
    const names = new Set(core.team.members.map((m) => m.name));
    const stranger = attendees.find((name) => !names.has(name));
    if (stranger) throw new Error(REFUSED.noMember(stranger));
    return [host, ...rest];
  }

  /** Throws why the goal isn't active, if it isn't. */
  private activeGoal() {
    const { goal } = this.core.state;
    if (goal.status !== "active") throw new Error(`The goal "${goal.name}" is ${goal.status}`);
  }

  /** A meeting whose plan is under review and can take `event`, or throws. */
  private underReview(id: string, event: "change" | "approve"): { meeting: Meeting; plan: Plan } {
    const meeting = this.core.state.meetings.find((m) => m.id === id);
    if (!meeting?.plan || !can(MEETING_MACHINE, meeting.status, event))
      throw new Error("That meeting has no plan under review");
    return { meeting, plan: meeting.plan };
  }

  /** Runs a meeting, kept as under way until it ends. */
  private track(meeting: Meeting) {
    const abort = new AbortController();
    const now: MeetingNow = { hands: [] };
    const ended = this.run(meeting, now, abort.signal).finally(() => {
      this.live.delete(meeting.id);
    });
    this.live.set(meeting.id, { abort, ended, now });
  }

  private async run(meeting: Meeting, now: MeetingNow, signal: AbortSignal) {
    const { core } = this;
    try {
      const cwd = await openGoal(core.places);
      const talk = new MeetingRun(core, meeting, now, signal, cwd);
      meeting.plan = await talk.toPlan();
      meeting.status = step(MEETING_MACHINE, meeting.status, "plan");
    } catch (error) {
      if (meeting.status === "running") {
        meeting.status = step(MEETING_MACHINE, meeting.status, signal.aborted ? "cancel" : "fail");
        if (!signal.aborted) meeting.error = errorText(error);
      }
    } finally {
      core.changed();
      // Its attendees are free again.
      this.scheduler.pump();
    }
  }
}

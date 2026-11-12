/**
 * Planning meetings (docs/design.md §4.2): the meetings' state machine
 * (MEETING_MACHINE) and their turns. The host opens; everyone else gives a
 * first judgment without hearing the others; then hands go up and the host
 * gives the floor, until it is settled or the size's turns are spent; then
 * the host writes the plan. Each attendee keeps one read-only session for
 * the whole meeting, in the goal's worktree.
 */
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createSdkMcpServer,
  tool,
  type AnyZodRawShape,
  type McpServerConfig,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { errorText, workOf, type Core } from "./core.ts";
import { busyMembers, meetingResumes } from "./derive.ts";
import { openGoal } from "./git.ts";
import { can, MEETING_MACHINE, step } from "./machines.ts";
import { hostPlanSchema, parsePlan } from "./plan.ts";
import {
  MEETING_TOOLS,
  meetingAnswer,
  meetingClosing,
  meetingHand,
  meetingOpening,
  meetingRound,
  meetingSteer,
  type MeetingBrief,
} from "./prompts.ts";
import type { Scheduler } from "./scheduler.ts";
import {
  askOnce,
  toolText,
  TURN_SERVER,
  turnToolName,
  type Reply,
  type TurnListener,
} from "./turns.ts";
import type {
  Goal,
  Meeting,
  MeetingHand,
  MeetingSize,
  MeetingTurn,
  Member,
  Plan,
  Subtask,
} from "./types.ts";

/** How many times each attendee but the host may have the floor in the discussion. */
const MEETING_TURNS_EACH: Record<MeetingSize, number> = {
  small: 1,
  discussion: 2,
  large: 4,
};

/** A turn's one meeting tool: its server, and its name as the turn's rules allow it. */
interface TurnTool {
  server: McpServerConfig;
  name: string;
}

const turnTool = <S extends AnyZodRawShape>(meetingTool: SdkMcpToolDefinition<S>): TurnTool => ({
  server: createSdkMcpServer({ name: TURN_SERVER, tools: [meetingTool] }),
  name: turnToolName(meetingTool.name),
});

/** The turn's raise_hand: calling it puts the hand up, not calling it leaves it down. */
const handTool = (raise: (hand: Omit<MeetingHand, "member">) => void) =>
  turnTool(
    tool(
      "raise_hand",
      MEETING_TOOLS.raiseHand.what,
      {
        point: z.string().trim().min(1).describe(MEETING_TOOLS.raiseHand.point),
        to: z.string().trim().optional().describe(MEETING_TOOLS.raiseHand.to),
      },
      ({ point, to }) => {
        raise({ point, ...(to && { to }) });
        return Promise.resolve(toolText(MEETING_TOOLS.raiseHand.done));
      },
    ),
  );

/** The host's give_floor: whom they call next, of the others (there are some: the talk needs them). */
const floorTool = (
  others: readonly Member[],
  give: (floor: { member: string; quiet?: boolean }) => void,
) =>
  turnTool(
    tool(
      "give_floor",
      MEETING_TOOLS.giveFloor.what,
      {
        member: z
          .enum(others.map((m) => m.name) as [string, ...string[]])
          .describe(MEETING_TOOLS.giveFloor.member),
        quiet: z.boolean().optional().describe(MEETING_TOOLS.giveFloor.quiet),
      },
      (floor) => {
        give(floor);
        return Promise.resolve(toolText(MEETING_TOOLS.giveFloor.done));
      },
    ),
  );

/** A meeting no longer under way: nobody speaks, writes the plan, weighs it or has a hand up. */
const quiet = (meeting: Meeting) =>
  Object.assign(meeting, {
    speaking: undefined,
    planning: undefined,
    weighing: undefined,
    hands: undefined,
  });

type Move =
  | { kind: "open" }
  | { kind: "round"; member: string }
  | { kind: "discuss"; left: number }
  | { kind: "answer"; member: string }
  | { kind: "close" };

/**
 * What comes next in a meeting, read off what has been said and its size: a
 * new meeting and one going on from where it stopped are the same walk.
 * However the talk goes, it ends in the closing.
 */
export function nextMove({
  turns,
  participants,
  size,
}: Pick<Meeting, "turns" | "participants" | "size">): Move {
  const last = turns.at(-1);
  if (!last) return { kind: "open" };
  const others = participants.slice(1);
  const waiting = others.find((m) => !turns.some((t) => t.phase === "round" && t.speaker === m));
  if (waiting) return { kind: "round", member: waiting };
  if (last.phase === "steer")
    return last.calls ? { kind: "answer", member: last.calls } : { kind: "close" };
  const left =
    others.length * MEETING_TURNS_EACH[size] - turns.filter((t) => t.phase === "answer").length;
  return left > 0 ? { kind: "discuss", left } : { kind: "close" };
}

/** What calling a meeting takes: its goal, what to plan, its size, and who attends, the host first. */
export interface MeetingCall {
  goalId: string;
  agenda: string;
  size: MeetingSize;
  /** Everyone, when empty. */
  attendees: string[];
}

export class Meetings {
  /** Meeting id → stops its run. */
  private aborts = new Map<string, AbortController>();
  /** Meeting id → its run, settling once it has ended. */
  private ongoing = new Map<string, Promise<void>>();

  constructor(
    private readonly core: Core,
    private readonly scheduler: Scheduler,
  ) {}

  /** Calls a meeting, or throws why it can't be held now. */
  start(call: MeetingCall): Meeting {
    const { core } = this;
    const named = [...new Set(call.attendees.map((name) => name.trim()))];
    const attendees = named.length
      ? named
      : core.team.members.map((m) => m.name).sort((a, b) => a.localeCompare(b));
    const host = this.admit(call.goalId, attendees);
    const meeting: Meeting = {
      id: randomUUID(),
      goalId: call.goalId,
      agenda: call.agenda,
      size: call.size,
      participants: attendees,
      host,
      status: "running",
      turns: [],
      tokens: 0,
      createdAt: Date.now(),
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
      throw new Error("That meeting can't go on: its plan is out, or its goal isn't active");
    this.admit(meeting.goalId, meeting.participants);
    meeting.status = step(MEETING_MACHINE, meeting.status, "resume");
    meeting.error = undefined;
    core.changed();
    this.track(meeting);
  }

  /**
   * Cancels a plan in review at once, or stops a meeting under way: it is
   * cancelled as its run ends, which the promise returned waits for.
   */
  cancel(id: string): Promise<void> | undefined {
    const meeting = this.core.state.meetings.find((m) => m.id === id);
    if (meeting?.status === "review") {
      meeting.status = step(MEETING_MACHINE, meeting.status, "cancel");
      this.core.changed();
      return;
    }
    this.aborts.get(id)?.abort();
    return this.ongoing.get(id);
  }

  /**
   * Your changes to a plan under review: `raw` is the whole plan as the host
   * hands one in (hostPlanSchema), and may give work to any member.
   */
  change(id: string, raw: unknown) {
    const { core } = this;
    const { meeting } = this.underReview(id, "change");
    // A plan under review came out of a meeting, so the team has members.
    const names = core.team.members.map((m) => m.name) as [string, ...string[]];
    meeting.plan = parsePlan(raw, names);
    core.changed();
  }

  /**
   * Approves a plan under review: its document is saved in the data folder,
   * and its tasks and subtasks go to the scheduler, pending until they can
   * start. Returns the subtasks.
   */
  async approve(id: string): Promise<Subtask[]> {
    const { core } = this;
    const { meeting, plan } = this.underReview(id, "approve");
    const goal = this.activeGoal(meeting.goalId);
    const file = path.join(core.places.root, "plans", `${goal.slug}-${meeting.id}.md`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, plan.markdown);
    // Changed, called off or approved meanwhile, or its goal held: not approved now (the file stays).
    if (meeting.plan !== plan || !can(MEETING_MACHINE, meeting.status, "approve"))
      throw new Error("The plan changed while it was being approved");
    this.activeGoal(goal.id);
    meeting.status = step(MEETING_MACHINE, meeting.status, "approve");
    meeting.planFile = file;
    return this.scheduler.assign(goal.id, plan.tasks, meeting.id);
  }

  /** Settles once no meeting of a goal is under way: one being cancelled has ended. */
  async settled(goalId: string) {
    const ids = this.core.state.meetings.filter((m) => m.goalId === goalId).map((m) => m.id);
    await Promise.all(ids.flatMap((id) => this.ongoing.get(id) ?? []));
  }

  /** Stops every meeting under way, as cancelled; settles once they have ended. */
  async close() {
    for (const abort of this.aborts.values()) abort.abort();
    await Promise.all(this.ongoing.values());
  }

  /** After a restart no meeting is under way: one that was is cancelled, to go on from where it was. */
  recover() {
    for (const meeting of this.core.state.meetings) {
      if (meeting.status !== "running") continue;
      meeting.status = step(MEETING_MACHINE, meeting.status, "cancel");
      quiet(meeting);
    }
  }

  /**
   * Whether these members can sit down together now for this goal: the goal
   * is active, each is on the team and free. Throws why not; gives the first,
   * who hosts. Nothing is
   * awaited here or before the meeting is under way, so two meetings can't
   * both take the same member.
   */
  private admit(goalId: string, attendees: readonly string[]): string {
    const { core } = this;
    this.activeGoal(goalId);
    const [host] = attendees;
    if (host === undefined) throw new Error("The team has no members");
    const names = new Set(core.team.members.map((m) => m.name));
    const stranger = attendees.find((name) => !names.has(name));
    if (stranger) throw new Error(`There is no member called "${stranger}"`);
    const busy = busyMembers(workOf(core));
    const taken = attendees.find((name) => busy.has(name));
    if (taken) throw new Error(`${taken} is busy: working, reviewing, or at another meeting`);
    return host;
  }

  /** A goal that is active, or throws why it isn't. */
  private activeGoal(goalId: string): Goal {
    const goal = this.core.state.goals.find((g) => g.id === goalId);
    if (!goal) throw new Error("There is no such goal");
    if (goal.status !== "active") throw new Error(`The goal "${goal.name}" is ${goal.status}`);
    return goal;
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
    this.aborts.set(meeting.id, abort);
    const run = this.run(meeting, abort.signal).finally(() => {
      this.aborts.delete(meeting.id);
      this.ongoing.delete(meeting.id);
    });
    this.ongoing.set(meeting.id, run);
  }

  private async run(meeting: Meeting, signal: AbortSignal) {
    const { core } = this;
    // All there: admit() has just checked, and nothing was awaited since.
    const [host, ...others] = meeting.participants.flatMap((name) =>
      core.team.members.filter((m) => m.name === name),
    );
    const goal = core.state.goals.find((g) => g.id === meeting.goalId);
    if (!host || !goal) return;
    let ctx: MeetingBrief = { meeting, goal, attendees: [host, ...others], cwd: "" };

    /**
     * One exchange in this member's session for the meeting, which goes on
     * across all their turns. `heard`: how many of the meeting's turns it
     * has taken in once done.
     */
    const ask = async (
      member: Member,
      prompt: string,
      turn: {
        heard?: number;
        tool?: TurnTool;
        schema?: Record<string, unknown>;
        signal?: AbortSignal;
        listener?: TurnListener;
      } = {},
    ): Promise<Reply> => {
      const heard = turn.heard ?? meeting.turns.length;
      const options = core.options(member, "meeting", ctx.cwd);
      const seat = meeting.seats?.[member.name];
      const reply = await askOnce({
        prompt,
        options: {
          ...options,
          ...(seat && { resume: seat.session }),
          ...(turn.tool && {
            mcpServers: { ...options.mcpServers, [TURN_SERVER]: turn.tool.server },
            allowedTools: [turn.tool.name],
          }),
        },
        ...(turn.schema && { schema: turn.schema }),
        signal: turn.signal ?? signal,
        ...(turn.listener && { listener: turn.listener }),
      });
      meeting.seats = { ...meeting.seats, [member.name]: { session: reply.session, heard } };
      meeting.tokens += reply.tokens;
      return reply;
    };
    /** A turn said aloud: it streams as it is said, and becomes the meeting's next turn once done. */
    const speak = (
      member: Member,
      prompt: string,
      turn: { heard?: number; tool?: TurnTool; schema?: Record<string, unknown> } = {},
    ) => {
      meeting.speaking = member.name;
      // The closing turn hands the plan back in its shape, with no words to stream.
      meeting.planning = turn.schema !== undefined;
      core.changed();
      return ask(member, prompt, { ...turn, listener: core.speech(meeting, member.name) });
    };
    const said = (
      speaker: Member,
      { text, tokens }: { text: string; tokens: number },
      phase: MeetingTurn["phase"],
      calls?: string,
    ) => {
      meeting.turns.push({
        speaker: speaker.name,
        text,
        at: Date.now(),
        phase,
        tokens,
        ...(calls !== undefined && { calls }),
      });
      core.changed();
    };
    const attendee = (name: string) => {
      const found = others.find((m) => m.name === name);
      if (!found) throw new Error(`${name} isn't at this meeting`);
      return found;
    };

    try {
      ctx = { ...ctx, cwd: await openGoal(core.places, goal.slug) };
      /** Whoever has the floor speaks: about what they raised their hand for, if they did. */
      const answer = async (name: string) => {
        const member = attendee(name);
        const point = meeting.hands?.find((hand) => hand.member === name)?.point;
        meeting.hands = undefined;
        said(member, await speak(member, meetingAnswer(ctx, member, point)), "answer");
      };
      /** Those who may speak next each decide whether to, all at once; one failing stops the others. */
      const weigh = async (who: Member[]) => {
        meeting.weighing = true;
        meeting.hands = [];
        core.changed();
        const stop = new AbortController();
        const weighing = AbortSignal.any([signal, stop.signal]);
        const asked = await Promise.allSettled(
          who.map((member) =>
            ask(member, meetingHand(ctx, member), {
              signal: weighing,
              tool: handTool((hand) => {
                meeting.hands = [
                  ...(meeting.hands ?? []).filter((h) => h.member !== member.name),
                  { member: member.name, ...hand },
                ];
                core.changed();
              }),
            }).catch((error: unknown) => {
              stop.abort();
              throw error;
            }),
          ),
        );
        meeting.weighing = undefined;
        core.changed();
        const failed = asked.find((r) => r.status === "rejected");
        if (failed) throw failed.reason;
      };
      /** A step of the discussion: hands go up, the host gives the floor or ends it. False once it is over. */
      const discuss = async (left: number) => {
        const last = meeting.turns.at(-1);
        // After the first judgments nobody has heard anyone yet, so even the last to speak may answer.
        await weigh(others.filter((m) => last?.phase === "round" || m.name !== last?.speaker));
        let floor: { member: string; quiet?: boolean } | undefined;
        const steer = await speak(host, meetingSteer(ctx, left), {
          tool: floorTool(others, (given) => (floor = given)),
        });
        // With hands up the talk goes on: if the host names nobody, the floor is the first hand's.
        const called = floor?.member ?? meeting.hands?.[0]?.member;
        const text = steer.text.trim();
        if (text && !floor?.quiet) said(host, { text, tokens: steer.tokens }, "steer", called);
        else if (called) await answer(called);
        else return false;
        return true;
      };
      let talking = true;
      for (
        let move = nextMove(meeting);
        talking && move.kind !== "close";
        move = nextMove(meeting)
      ) {
        switch (move.kind) {
          case "open":
            said(host, await speak(host, meetingOpening(ctx)), "opening");
            break;
          case "round": {
            // What they heard is the opening alone: the others' first judgments reach them after.
            const member = attendee(move.member);
            said(member, await speak(member, meetingRound(ctx, member), { heard: 1 }), "round");
            break;
          }
          case "answer":
            await answer(move.member);
            break;
          case "discuss":
            talking = await discuss(move.left);
        }
      }
      meeting.hands = undefined;
      const names = ctx.attendees.map((m) => m.name) as [string, ...string[]];
      const closing = await speak(host, meetingClosing(ctx), {
        schema: z.toJSONSchema(hostPlanSchema(names)),
      });
      // Stopped as the plan came in: there is no plan, and it ends as any stop does.
      signal.throwIfAborted();
      meeting.plan = parsePlan(closing.structured, names);
      said(host, { text: meeting.plan.summary, tokens: closing.tokens }, "summary");
      meeting.status = step(MEETING_MACHINE, meeting.status, "plan");
      // With its plan out a meeting can't go on: the sessions it kept have served.
      meeting.seats = undefined;
    } catch (error) {
      if (meeting.status === "running") {
        meeting.status = step(MEETING_MACHINE, meeting.status, signal.aborted ? "cancel" : "fail");
        if (!signal.aborted) meeting.error = errorText(error);
      }
    } finally {
      quiet(meeting);
      core.changed();
      // Its attendees are free again.
      this.scheduler.pump();
    }
  }
}

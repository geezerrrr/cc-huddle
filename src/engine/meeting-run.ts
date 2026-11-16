/**
 * One meeting's talk, from where it is to the host's plan (docs/design.md
 * §4.2). The host opens; every member gives a first judgment, all at once
 * and without hearing the others; then hands go up and the host gives the
 * floor, until it is settled or the size's turns are spent; then the host
 * writes the plan. Each attendee keeps one read-only session for the whole
 * meeting, in the goal's worktree. What goes on meanwhile is told in `now`;
 * the meeting's status is its owner's (meetings.ts).
 */
import {
  tool,
  type AnyZodRawShape,
  type McpServerConfig,
  type SdkMcpToolDefinition,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { toolText } from "../shared/text.ts";
import { spend, type Core } from "./core.ts";
import { hostPlanSchema, hostWritten, soundPlan } from "./plan.ts";
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
import {
  askOnce,
  turnServer,
  turnToolName,
  withTurn,
  type Reply,
  type TurnListener,
} from "./turns.ts";
import type {
  Meeting,
  MeetingHand,
  MeetingNow,
  MeetingSize,
  MeetingTurn,
  Member,
  Plan,
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
  server: turnServer([meetingTool]),
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

/** Who takes part as a member (§4.2): everyone at it, but a host who only runs it. */
const meetingMembers = ({ participants, hostOnly }: Pick<Meeting, "participants" | "hostOnly">) =>
  hostOnly ? participants.slice(1) : participants;

type Move =
  | { kind: "open" }
  | { kind: "round"; members: string[] }
  | { kind: "discuss"; left: number }
  | { kind: "answer"; member: string }
  | { kind: "close" };

/**
 * What comes next in a meeting, read off what has been said and its size: a
 * new meeting and one going on from where it stopped are the same walk.
 * However the talk goes, it ends in the closing.
 */
export function nextMove(
  meeting: Pick<Meeting, "turns" | "participants" | "hostOnly" | "size">,
): Move {
  const { turns, participants, size } = meeting;
  const last = turns.at(-1);
  if (!last) return { kind: "open" };
  const others = participants.slice(1);
  // The first judgments come before any talk: once it is on, nobody gives one.
  const talking = turns.some((t) => t.phase === "steer" || t.phase === "answer");
  const waiting = meetingMembers(meeting).filter(
    (m) => !turns.some((t) => t.phase === "round" && t.speaker === m),
  );
  if (!talking && waiting.length) return { kind: "round", members: waiting };
  if (last.phase === "steer")
    return last.calls ? { kind: "answer", member: last.calls } : { kind: "close" };
  const left =
    others.length * MEETING_TURNS_EACH[size] - turns.filter((t) => t.phase === "answer").length;
  return left > 0 ? { kind: "discuss", left } : { kind: "close" };
}

/** What one exchange in a member's session for the meeting takes beside its prompt. */
interface Exchange {
  /** How many of the meeting's turns the session has taken in once done; all of them unless said. */
  heard?: number;
  tool?: TurnTool;
  /** The shape the turn hands its result back in. */
  schema?: z.ZodType;
  signal?: AbortSignal;
  listener?: TurnListener;
}

export class MeetingRun {
  private readonly host: Member;
  /** Everyone at it but the host. */
  private readonly others: Member[];
  private readonly ctx: MeetingBrief;

  /** Throws when its host or members aren't on the team. */
  constructor(
    private readonly core: Core,
    private readonly meeting: Meeting,
    private readonly now: MeetingNow,
    private readonly signal: AbortSignal,
    /** The goal's worktree, where the meeting looks. */
    cwd: string,
  ) {
    const { goal } = core.state;
    const named = (names: readonly string[]) =>
      names.flatMap((name) => core.team.members.filter((m) => m.name === name));
    const [host, ...others] = named(meeting.participants);
    // A host who only runs it has someone else at it (Meetings.start), so there are members.
    const [member, ...more] = named(meetingMembers(meeting));
    if (!host || !member) throw new Error("The meeting's host or members aren't on the team");
    this.host = host;
    this.others = others;
    this.ctx = { meeting, goal, attendees: [host, ...others], members: [member, ...more], cwd };
  }

  /**
   * Talks it through from where it is and has the host write the plan, its
   * summary the meeting's last turn. Throws when a turn fails, or it was
   * stopped, before the plan is out.
   */
  async toPlan(): Promise<Plan> {
    let talking = true;
    for (
      let move = nextMove(this.meeting);
      talking && move.kind !== "close";
      move = nextMove(this.meeting)
    ) {
      switch (move.kind) {
        case "open":
          this.said(
            this.host,
            (await this.speak(this.host, meetingOpening(this.ctx))).text,
            "opening",
          );
          break;
        case "round":
          await this.round(move.members.map((name) => this.attendee(name)));
          break;
        case "answer":
          await this.answer(move.member);
          break;
        case "discuss":
          talking = await this.discuss(move.left);
      }
    }
    this.now.hands = [];
    // Who gets work in the plan: a host who only runs the meeting gets none.
    const names = this.ctx.members.map((m) => m.name) as [string, ...string[]];
    const schema = hostPlanSchema(names);
    const closing = await this.speak(this.host, meetingClosing(this.ctx), { schema });
    // Stopped as the plan came in: there is no plan, and it ends as any stop does.
    this.signal.throwIfAborted();
    const plan = soundPlan(hostWritten(schema.parse(closing.structured)), "drop");
    this.said(this.host, plan.summary, "summary");
    // With its plan out a meeting can't go on: the sessions it kept have served.
    this.meeting.seats = undefined;
    return plan;
  }

  /** One exchange in this member's session for the meeting, which goes on across all their turns. */
  private async ask(member: Member, prompt: string, turn: Exchange = {}): Promise<Reply> {
    const { core, meeting } = this;
    const heard = turn.heard ?? meeting.turns.length;
    const options = core.options(member, "readOnly", this.ctx.cwd);
    const seat = meeting.seats?.[member.name];
    const reply = await askOnce({
      prompt,
      options: withTurn(options, {
        ...(seat && { resume: seat.session }),
        ...(turn.tool && { server: turn.tool.server, allowed: [turn.tool.name] }),
      }),
      ...(turn.schema && { schema: turn.schema }),
      signal: turn.signal ?? this.signal,
      spent: (tokens) => {
        spend(core.state, member.name, tokens);
      },
      ...(turn.listener && { listener: turn.listener }),
    });
    meeting.seats = { ...meeting.seats, [member.name]: { session: reply.session, heard } };
    return reply;
  }

  /**
   * A turn said aloud: it streams as it is said, and becomes the meeting's
   * next turn once done; nobody is speaking then. `saying`: the message
   * under way, each time it grows.
   */
  private async speak(
    member: Member,
    prompt: string,
    turn: Omit<Exchange, "signal" | "listener"> & { saying?: (words: string) => void } = {},
  ): Promise<Reply> {
    const { saying, ...asked } = turn;
    // The closing turn hands the plan back in its shape, with no words to stream.
    this.now.speaking = { member: member.name, planning: turn.schema !== undefined };
    const speech = this.core.speech(this.meeting);
    let words = "";
    try {
      return await this.ask(member, prompt, {
        ...asked,
        listener: {
          ...speech,
          text: (delta, fresh) => {
            speech.text?.(delta, fresh);
            words = fresh ? delta : words + delta;
            saying?.(words);
          },
        },
      });
    } finally {
      this.now.speaking = undefined;
    }
  }

  private said(speaker: Member, text: string, phase: MeetingTurn["phase"], calls?: string) {
    this.meeting.turns.push({
      speaker: speaker.name,
      text,
      phase,
      ...(calls !== undefined && { calls }),
    });
    this.core.changed();
  }

  private attendee(name: string): Member {
    const found = this.ctx.attendees.find((m) => m.name === name);
    if (!found) throw new Error(`${name} isn't at this meeting`);
    return found;
  }

  /** Whoever has the floor speaks: about what they raised their hand for, if they did. */
  private async answer(name: string) {
    const member = this.attendee(name);
    const point = this.now.hands.find((hand) => hand.member === name)?.point;
    this.now.hands = [];
    this.said(
      member,
      (await this.speak(member, meetingAnswer(this.ctx, member, point))).text,
      "answer",
    );
  }

  /** Each of `who` at once, doing `what` meanwhile: one failing stops the others, and fails the lot. */
  private async allAtOnce(
    who: Member[],
    what: NonNullable<MeetingNow["together"]>,
    each: (member: Member, signal: AbortSignal) => Promise<unknown>,
  ) {
    this.now.together = what;
    const stop = new AbortController();
    const together = AbortSignal.any([this.signal, stop.signal]);
    const settled = await Promise.allSettled(
      who.map((member) =>
        each(member, together).catch((error: unknown) => {
          stop.abort();
          throw error;
        }),
      ),
    );
    this.now.together = undefined;
    const failed = settled.find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
  }

  /** Those who may speak next each decide whether to. */
  private weigh(who: Member[]) {
    this.now.hands = [];
    return this.allAtOnce(who, "weighing", (member, weighing) =>
      this.ask(member, meetingHand(this.ctx, member), {
        signal: weighing,
        tool: handTool((hand) => {
          this.now.hands = [
            ...this.now.hands.filter((h) => h.member !== member.name),
            { member: member.name, ...hand },
          ];
        }),
      }),
    );
  }

  /** The first judgments: none hears the others, so none waits for them. Each becomes a turn once given. */
  private round(who: Member[]) {
    return this.allAtOnce(who, "drafting", async (member, drafting) => {
      // What they heard is the opening alone: the others' first judgments reach them after.
      const judged = await this.ask(member, meetingRound(this.ctx, member), {
        heard: 1,
        signal: drafting,
      });
      this.said(member, judged.text, "round");
    });
  }

  /** A step of the discussion: hands go up, the host gives the floor or ends it. False once it is over. */
  private async discuss(left: number): Promise<boolean> {
    const last = this.meeting.turns.at(-1);
    // After the first judgments nobody has heard anyone yet, so even the last to speak may answer.
    await this.weigh(
      this.others.filter((m) => last?.phase === "round" || m.name !== last?.speaker),
    );
    let floor: { member: string; quiet?: boolean } | undefined;
    let saying = "";
    // What the host says before handing the floor over is said to the room, as what follows is.
    let before = "";
    const steer = await this.speak(this.host, meetingSteer(this.ctx, left, this.now.hands), {
      tool: floorTool(this.others, (given) => {
        floor = given;
        before = saying.trim();
      }),
      saying: (words) => (saying = words),
    });
    // The host naming nobody closes the talk, hands up or not: which hands are worth the floor is theirs to judge.
    const called = floor?.member;
    const after = steer.text.trim();
    const text = before && before !== after ? [before, after].filter(Boolean).join("\n\n") : after;
    if (text && !floor?.quiet) this.said(this.host, text, "steer", called);
    else if (called) await this.answer(called);
    else return false;
    return true;
  }
}

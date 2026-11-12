/**
 * Every prompt the engine sends (docs/design.md §3.1), in one module. Only
 * models read them, so they are in English.
 */
import type { Delivery, Goal, GoOn, Meeting, MeetingSize, Member, Subtask, Task } from "./types.ts";

/** The kinds of session a member works in. */
export type SessionKind = "task" | "meeting" | "answer" | "review";

/** Names in a sentence: "a, b and c". */
const listOf = (items: readonly string[]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(items);

/** A member by name and role, as their teammates know them. */
const called = (member: Member) => `${member.name} (${member.role.title})`;

const TASK_WAYS = `# How you work on a subtask
- You work in a git worktree of your own, on a branch cut from the goal's branch, which is merged into the goal's branch once you deliver. Teammates working at the same time each have theirs, so you never get in each other's way. Stay in yours.
- Commit as you go if you like; whatever is uncommitted when you deliver is committed for you.
- When you need information or a decision from a teammate (an interface, a design detail), ask them with ask_teammate. It waits for their answer.
- When you need the user to decide something or give you what only they have, ask with AskUserQuestion, offering options, and wait for the answer. Don't just write that you are waiting: the user may not be watching.
- When you are done, call deliver with a summary of a few sentences (what you did, anything to watch out for) and the files that are the result. Your subtask isn't done until you deliver; then end your turn.`;

/** What is appended to Claude Code's system prompt for a member's session: who they are, and how to work. */
export function systemPrompt(kind: SessionKind, member: Member, team: readonly Member[]): string {
  const others = team.filter((m) => m.name !== member.name).map(called);
  const who = `# Who you are
You are ${member.name}, the ${member.role.title} on a team of Claude Code sessions working on this repository. Each member is a session of its own, often on another model. The user directs the team from their own Claude Code session.
${others.length ? `Your teammates: ${others.join(", ")}.` : "You are the only member."}

# Your duties
${member.role.duties.trim()}`;
  return kind === "task" ? `${who}\n\n${TASK_WAYS}` : who;
}

/** Work a subtask builds on, with what it delivered: what it depends on directly, or further up. */
export interface Upstream {
  subtask: Subtask;
  direct: boolean;
}

/**
 * The first message of a subtask's run: the goal, the task, the subtask,
 * where to work, the plan it is part of (the approved plan's document, when
 * it came from one), what came from upstream, and your words for it from
 * before it had a session to go on in (`notes`: you added to it, or sent its
 * task back).
 */
export function taskBrief(input: {
  goal: Goal;
  task: Task;
  subtask: Subtask;
  cwd: string;
  branch: string;
  plan?: string;
  upstream: readonly Upstream[];
  notes: readonly GoOn[];
}): string {
  const { goal, task, subtask } = input;
  const lines = [
    `Goal: ${goal.name}`,
    `Task: ${task.title}${task.outcome && task.outcome !== task.title ? `. ${task.outcome}` : ""}`,
    "",
    `Your subtask: ${subtask.title}`,
    ...(subtask.description && subtask.description !== subtask.title ? [subtask.description] : []),
    ...(subtask.acceptance ? ["", `Acceptance criteria: ${subtask.acceptance}`] : []),
    "",
    `Your worktree is ${input.cwd}, on branch ${input.branch}.`,
  ];
  if (input.plan)
    lines.push("", "The plan your team agreed on, which this subtask is part of:", "", input.plan);
  const delivered = (s: Subtask) =>
    `- ${s.title}, by ${s.assignee}: ${s.delivery?.summary ?? ""}${s.delivery?.files.length ? ` Files: ${s.delivery.files.join(", ")}` : ""}`;
  const direct = input.upstream.filter((u) => u.direct).map((u) => delivered(u.subtask));
  const further = input.upstream.filter((u) => !u.direct).map((u) => delivered(u.subtask));
  if (direct.length)
    lines.push("", "It builds on this work, merged into the goal's branch:", ...direct);
  if (further.length) lines.push("", "Which built on:", ...further);
  for (const { why, note } of input.notes)
    if (why === "revised")
      lines.push("", `The user sent this task back before, asking for:\n${note ?? ""}`);
    else if (why === "carried") lines.push("", `The user adds to your subtask:\n${note ?? ""}`);
  return lines.join("\n");
}

/**
 * The first message of a run that goes on in the session of the one before
 * (Subtask.goOn): each thing that came up since, once, in the order it came.
 */
export function goOnMessage(reasons: readonly GoOn[], subtask: Subtask): string {
  const said = ({ why, note = "" }: GoOn) => {
    switch (why) {
      case "held":
        return "Your work was paused and now goes on. Pick up where you left off.";
      case "carried":
        return `The user adds to your subtask:\n${note}`;
      case "continued":
        return "The user asks you to go on from where you stopped.";
      case "rejected":
        return `The review sent your delivery back. Fix what it says, then deliver again:\n${subtask.review?.notes ?? ""}`;
      case "conflict":
        return `Merging your delivery into the goal's branch left conflicts in ${subtask.conflict?.files.join(", ") ?? ""}. The merge is under way in your worktree, the conflict markers in those files. Resolve them, keeping what both sides meant, then deliver again.`;
      case "redo":
        return `Work you build on was redone after you delivered: ${note}. Your worktree now starts from the goal's branch as it stands. Check your part against it, change what needs changing, and deliver again.`;
      case "revised":
        return `The user sent your task back, asking for:\n${note}\nMake those changes, then deliver again.`;
    }
  };
  return [...new Set(reasons.map(said))].join("\n\n");
}

/** A run ended without delivering: it is reminded once, in the same session. */
export const DELIVER_REMINDER =
  "You haven't delivered yet. If the work is finished, call deliver now with a summary and the files that are the result. If you can't finish it, say what stands in the way.";

/** A subagent the member started may not speak for the subtask: asking and delivering are the session's own. */
export const SESSION_ONLY =
  "Only the session that started you asks teammates and delivers this subtask: do your own part and report back to it.";

/** What a reviewer is asked: the subtask, its acceptance criteria and what was delivered, checked in its worktree. */
export function reviewPrompt(input: {
  task: Task;
  subtask: Subtask;
  delivery: Delivery;
  cwd: string;
}): string {
  const { task, subtask, delivery } = input;
  const files = delivery.files.length
    ? delivery.files.join(", ")
    : "none (the summary is the result)";
  return `You're reviewing a teammate's delivery before it is merged into the goal's branch.

Task: ${task.title}
Subtask: ${subtask.title}
${subtask.description && subtask.description !== subtask.title ? `${subtask.description}\n` : ""}Acceptance criteria: ${subtask.acceptance || "none given: judge whether the subtask is done as described"}

${subtask.assignee} delivered:
${delivery.summary}
Files: ${files}

Their worktree is ${input.cwd}. Read the files, and whatever else you need there, to check the work against the criteria, and stop once you can tell. Pass it when it meets them, even if you would have done it differently; send it back only for what really falls short, and say exactly what to fix.`;
}

/** A teammate's question, with what the member asked has done on the goal. */
export function teammateQuestion(input: {
  from: Member;
  subtask: Subtask;
  question: string;
  /** The subtasks of the goal the member asked has. */
  own: readonly Subtask[];
}): string {
  const own = input.own.map(
    (s) => `- ${s.title} (${s.status})${s.delivery ? `: ${s.delivery.summary}` : ""}`,
  );
  return `Your teammate ${called(input.from)} asks you this while working on "${input.subtask.title}":
${input.question}

${own.length ? `Your own work on this goal:\n${own.join("\n")}` : "You have no work of your own on this goal yet."}

Look up only what the answer needs, then answer briefly from your role. Where you're unsure, make a suggestion and state your assumptions.`;
}

/** A meeting as its prompts need it: the attendees in order, the host first, and the goal's worktree they look at. */
export interface MeetingBrief {
  meeting: Meeting;
  goal: Goal;
  attendees: readonly [Member, ...Member[]];
  cwd: string;
}

/** What has been said since `member` last took the meeting in, in their session; their own words they have. */
function news({ meeting }: MeetingBrief, member: Member) {
  const heard = meeting.seats?.[member.name]?.heard ?? 0;
  const fresh = meeting.turns.slice(heard).filter((t) => t.speaker !== member.name);
  return fresh.map((t) => `[${t.speaker}] ${t.text}`).join("\n\n") || "(nothing new)";
}

/** What a meeting turn delivers: what someone says aloud, not a document. */
const SPOKEN = "Say it as you would out loud in a meeting: a few sentences, no headings or lists.";

/**
 * How each size of meeting is run: `raise` finishes "raise your hand only
 * if", `settled` is what the host must be sure of before closing.
 */
const MEETING_KINDS: Record<MeetingSize, { how: string; raise: string; settled: string }> = {
  small: {
    how: "This is a short meeting: everyone gives their judgment once, then only the real conflicts between those judgments get talked through.",
    raise:
      "your judgment conflicts with someone else's, or someone has put a question straight to you",
    settled: "every conflict between people's judgments has been talked through",
  },
  discussion: {
    how: "This is a working discussion: everyone gives their judgment, then you talk through whatever would change the plan.",
    raise: "the plan would come out differently if you didn't say it",
    settled:
      "each thing the meeting set out to decide has had its options compared, with reasons given",
  },
  large: {
    how: "This is an open discussion: everyone gives their judgment, then you test the assumptions and weigh the alternatives before the plan is written.",
    raise:
      "the plan would come out differently if you didn't say it, or you doubt an assumption nobody has questioned, or you see another way of doing it",
    settled:
      "each thing the meeting set out to decide has had its options compared, with reasons given, and every assumption the plan rests on has been questioned by someone",
  },
};

/** The tools of a meeting's discussion, as the model is told of them. */
export const MEETING_TOOLS = {
  raiseHand: {
    what: "Puts your hand up to speak next at the meeting. Not calling it leaves your hand down.",
    point: "What you would say, in one line",
    to: "Whom it is for, by name, if it is for someone",
    done: "Your hand is up.",
  },
  giveFloor: {
    what: "Gives one attendee the floor: they speak next.",
    member: "Who speaks next, by name",
    quiet: "True when you have nothing to say yourself before they speak",
    done: "They have the floor.",
  },
};

/** What an attendee is told as their session at the meeting starts; once in it, they know all this. */
function briefing(ctx: MeetingBrief, member: Member) {
  const { meeting } = ctx;
  if (meeting.seats?.[member.name]) return "";
  return `You're ${member.name === meeting.host ? "hosting" : "taking part in"} a planning meeting.
Goal: ${ctx.goal.name}
To plan: ${meeting.agenda}
The goal's worktree: ${ctx.cwd} (look at what is there; this meeting is read-only)
Attending: ${listOf(ctx.attendees.map(called))}
${MEETING_KINDS[meeting.size].how}

`;
}

/** The host opens the meeting. */
export function meetingOpening(ctx: MeetingBrief) {
  return `${briefing(ctx, ctx.attendees[0])}Open the meeting: restate the goal and the scope, then list the things this meeting has to decide. Put them to everyone as open questions: don't answer them or suggest answers yet, and don't hand topics out by role. You'll give your own view later. Don't write the plan. ${SPOKEN}`;
}

/** An attendee's first judgment: they have heard the opening and nobody else. */
export function meetingRound(ctx: MeetingBrief, member: Member) {
  return `${briefing(ctx, member)}The host opened with:
${ctx.meeting.turns[0]?.text ?? ""}

Everyone now gives a first judgment without hearing each other, so you haven't heard what the others think. Give your own: what you would do about the things to decide and why, and what could go wrong. Your role is the angle you see it from, not the limit of what you may speak to, so if you have a view on something outside it, say it. Don't say who takes which work; that comes when the plan is written. ${SPOKEN}`;
}

/** Whether an attendee wants to speak next. */
export function meetingHand(ctx: MeetingBrief, member: Member) {
  return `${briefing(ctx, member)}Said since you last took it in:
${news(ctx, member)}

Would you speak next? Raise your hand only if ${MEETING_KINDS[ctx.meeting.size].raise}. Agreeing with what was said is no reason to. If you would, call raise_hand. If not, don't call it. Either way this isn't your turn to speak: nothing you write besides the call is heard.`;
}

/** Someone given the floor speaks: `point` is what they raised their hand about, if they did. */
export function meetingAnswer(ctx: MeetingBrief, member: Member, point?: string) {
  return `${briefing(ctx, member)}Said since you last took it in:
${news(ctx, member)}

You have the floor${point ? `, for what you raised your hand about: ${point}` : ": the host has called on you"}. Say it to the person it's for and take up what they actually said. Agree only where you have a reason of your own; if you disagree, say so and why; don't make up a disagreement. ${SPOKEN}`;
}

/** The host gives the floor, or ends the discussion; `left`: how many more times they can give it. */
export function meetingSteer(ctx: MeetingBrief, left: number) {
  const { meeting, attendees } = ctx;
  const host = attendees[0];
  const hands = (meeting.hands ?? []).map(
    (h) => `- ${h.member}${h.to ? ` (to ${h.to})` : ""}: ${h.point}`,
  );
  const had = attendees
    .slice(1)
    .map(
      (m) =>
        `${m.name} ${String(meeting.turns.filter((t) => t.phase === "answer" && t.speaker === m.name).length)}`,
    );
  const first = !meeting.turns.some((t) => t.phase === "steer" || t.phase === "answer");
  return `${briefing(ctx, host)}Said since you last took it in:
${news(ctx, host)}

${hands.length ? `Hands up:\n${hands.join("\n")}` : "Nobody has a hand up."}
Times each has had the floor in the discussion: ${listOf(had)}.
You can give the floor ${String(left)} more time${left === 1 ? "" : "s"} at most.

${first ? "You have now heard everyone's first judgment. Say how they differ and what you think yourself." : "Say something yourself only if you have something to add."}
With hands up, give the floor to one of them: whoever has been challenged first, otherwise whoever has spoken least. You may also give it to someone without a hand up who should answer.
With no hands up, go back over what you set out to decide: is it true that ${MEETING_KINDS[meeting.size].settled}? If not, give the floor to the one who should take up what's missing. If so, don't give the floor: close the talk in a sentence, and you'll write the plan after.
Call give_floor first, then what you say to the room is your last message. ${SPOKEN}`;
}

/** The host closes with the plan, handed back in the plan's shape. */
export function meetingClosing(ctx: MeetingBrief) {
  const { attendees } = ctx;
  return `${briefing(ctx, attendees[0])}Said since you last took it in:
${news(ctx, attendees[0])}

You're the host: turn the discussion into the final plan.
Attending (subtasks can only go to them): ${listOf(attendees.map(called))}

Requirements:
- Break the work into 1–4 tasks with 1–4 subtasks each; every subtask goes to exactly one attendee, whose name goes in assignee: ${listOf(attendees.map((m) => `"${m.name}"`))}. You decide who takes what, from their roles.
- Spell out the dependencies between subtasks in depends_on (the keys of other subtasks); don't make sequential what can run in parallel.
- Dependencies must not loop: no subtask may wait, directly or through others, on itself or on a subtask that waits on it.
- A subtask that depends on one in another task starts only when that whole task is finished and the user has accepted it. So tasks can only wait on each other one way: work that needs every other task's result, such as a final integration, is a task of its own.
- Give every subtask a clear description and acceptance criteria: its member reads them, and the plan document, before starting.
- plan_markdown is the plan document for the user and the team: the goal and scope; what was decided, why, and what was turned down; where people didn't agree and how you ruled; what the meeting didn't get to; then who does what, dependencies and risks.
- summary states the outcome in one sentence.`;
}

/**
 * The team as openplan's pane shows it (docs/design.md §7.2), worked out here
 * from the state so the mod only draws: the band's words, the meeting, each
 * member at what they do, what waits on you with the answers it takes, the
 * milestones the transcript keeps, what your session is asked to talk over,
 * and a member's record with each call in its line.
 */
import type {
  OpenplanCall,
  OpenplanEntry,
  OpenplanLive,
  OpenplanMeeting,
  OpenplanMember,
  OpenplanNeed,
  OpenplanTeam,
} from "../../plugin/types/index.d.ts";
import type { GoalEntry } from "../engine/data.ts";
import { derive, reviewerOf, type Work } from "../engine/derive.ts";
import type { LiveRun, RecordEntry } from "../engine/records.ts";
import {
  DECISIONS,
  PERMISSION_NOTE,
  toYou,
  type DecisionOption,
  type Derived,
  type Member,
  type Meeting,
  type PermissionOption,
  type QuestionToYou,
  type Subtask,
} from "../engine/types.ts";
import { othersOf } from "./status.ts";
import {
  goalLabel,
  mainArgument,
  meetingStatus,
  needWords,
  noGoalText,
  NOTE_PROMPTS,
  OPTION_LABELS,
  PLAN_TO_REVIEW,
  plural,
  resumeRefusal,
  underWay,
  waitText,
  whereOf,
} from "./words.ts";

/** The meeting the pane shows: one under way, else one whose plan waits on you, else the latest. */
export function shownMeeting(work: Work): Meeting | undefined {
  const latest = (status?: Meeting["status"]) =>
    work.meetings.filter((m) => !status || m.status === status).at(-1);
  return latest("running") ?? latest("review") ?? latest();
}

const meetingOf = (meeting: Meeting, work: Work): OpenplanMeeting => ({
  // Its agenda is the brief your session wrote for it, too long for a line.
  about: work.goal.name,
  agenda: meeting.agenda,
  status: meetingStatus(meeting),
  host: meeting.host,
  participants: meeting.participants,
  turns: meeting.turns.map((t) => ({
    speaker: t.speaker,
    text: t.text,
    ...(t.calls && { to: t.calls }),
  })),
  hands: (meeting.hands ?? []).map((h) => ({ member: h.member, point: h.point })),
  ...(meeting.plan && { plan: meeting.plan.summary }),
});

function memberOf(member: Member, work: Work, derived: ReturnType<typeof derive>): OpenplanMember {
  const own = work.subtasks.filter((s) => s.assignee === member.name);
  const at = (status: Subtask["status"]) => own.find((s) => s.status === status);
  const reviewing = work.subtasks.find(
    (s) =>
      s.status === "reviewing" &&
      s.assignee !== member.name &&
      reviewerOf(work, s) === member.name &&
      derived.busy.includes(member.name),
  );
  const meeting = work.meetings.find(
    (m) => m.status === "running" && m.participants.includes(member.name),
  );
  const next = at("pending");
  const running = at("running");
  const handedOver = at("reviewing") ?? at("merging");
  let doing: string | undefined;
  if (running) doing = underWay(running);
  else if (meeting) doing = `at the meeting on "${work.goal.name}"`;
  else if (reviewing) doing = `reviews "${reviewing.title}" by ${reviewing.assignee}`;
  else if (handedOver) doing = underWay(handedOver);
  else if (next) {
    const waits = derived.subtasks[next.id]?.waits ?? [];
    doing = `next: "${next.title}"${waits.length ? `, ${waits.map((w) => waitText(w, work)).join(", ")}` : ""}`;
  } else doing = "free";
  const followed =
    running ??
    own.filter((s) => s.startedAt).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
  const spoken = work.meetings
    .flatMap((m) => m.turns)
    .filter((t) => t.speaker === member.name)
    .reduce((sum, t) => sum + t.tokens, 0);
  return {
    name: member.name,
    role: member.role.title,
    ...(member.model && { model: member.model }),
    doing: doing ?? "free",
    ...(followed && { subtask: followed.id }),
    tokens: own.reduce((sum, s) => sum + s.tokens, 0) + spoken,
  };
}

/** An answer a need takes, labelled. */
const optionOf = (value: PermissionOption | DecisionOption) => ({
  value,
  label: OPTION_LABELS[value],
});

/** The answer a note typed instead of a pick goes with, if `options` offers it. */
function noteOf(
  options: readonly (PermissionOption | DecisionOption)[],
  note: { option: PermissionOption | DecisionOption; needed?: true } | undefined,
) {
  if (!note || !options.includes(note.option)) return undefined;
  return {
    option: note.option,
    prompt: NOTE_PROMPTS[note.option] ?? OPTION_LABELS[note.option],
    needed: note.needed === true,
  };
}

function needOf(question: QuestionToYou, work: Work): OpenplanNeed {
  const { headline, detail } = needWords(question, work);
  const head = {
    id: question.id,
    from: question.from,
    headline,
    ...(detail && { detail }),
    ask: question.kind !== "decision" || question.decision.kind !== "delivery",
  };
  switch (question.kind) {
    case "permission": {
      const { options } = question.permission;
      const note = noteOf(options, { option: PERMISSION_NOTE });
      return {
        ...head,
        kind: "options",
        options: options.map((o) => ({
          ...optionOf(o),
          ...(o === "once" && { primary: true as const }),
        })),
        ...(note && { note }),
      };
    }
    case "choices":
      return {
        ...head,
        kind: "choices",
        choices: question.choices.map((c) => ({
          question: c.question,
          header: c.header,
          options: c.options.map((o) => o.label),
          multiSelect: c.multiSelect,
        })),
      };
    case "decision": {
      const { kind, options } = question.decision;
      const note = noteOf(options, DECISIONS[kind].note);
      const subtask = work.subtasks.find((s) => s.id === question.subtaskId);
      const done = work.subtasks.filter((s) => s.taskId === subtask?.taskId && s.status === "done");
      return {
        ...head,
        kind: "options",
        options: options.map(optionOf),
        ...(note && { note }),
        ...(kind === "delivery" && {
          sendBack: done.map((s) => ({ id: s.id, title: s.title })),
        }),
      };
    }
  }
}

/** What the transcript keeps a line of, each once. */
function milestones(work: Work): OpenplanTeam["milestones"] {
  const said: OpenplanTeam["milestones"] = [];
  for (const meeting of work.meetings)
    if (meeting.status === "approved")
      said.push({ key: `plan:${meeting.id}`, text: `Plan approved: "${work.goal.name}"` });
  for (const s of work.subtasks) {
    if (s.review?.rounds)
      said.push({
        key: `back:${s.id}:${String(s.review.rounds)}`,
        text: `"${s.title}" went back to ${s.assignee}${s.review.notes ? `: ${s.review.notes}` : ""}`,
      });
    if (s.status === "done")
      said.push({ key: `done:${s.id}`, text: `"${s.title}" by ${s.assignee} is merged` });
    if (s.status === "failed")
      said.push({
        key: `failed:${s.id}:${String(s.startedAt ?? 0)}`,
        text: `"${s.title}" by ${s.assignee} failed${s.error ? `: ${s.error}` : ""}`,
      });
  }
  // A task is done once its last subtask merges, whether or not you accept it (§7.1).
  for (const task of work.tasks)
    if (work.subtasks.every((s) => s.taskId !== task.id || s.status === "done"))
      said.push({ key: `task:${task.id}`, text: `The task "${task.title}" is done` });
  return said;
}

/**
 * What needs a conversation (§7.3): each plan out for review, and each task
 * done, waiting to be accepted. The mod submits each new one to your session.
 */
function prompts(work: Work): OpenplanTeam["prompts"] {
  const asked: OpenplanTeam["prompts"] = [];
  for (const meeting of work.meetings)
    if (meeting.status === "review" && meeting.plan)
      asked.push({
        key: `review:${meeting.id}`,
        text: `The meeting [${meeting.id}] on "${work.goal.name}" has a plan: ${meeting.plan.summary}. Get it with show_plan and show it to the user in full: its document as it is written, then its tasks, each with its subtasks, who does them and what each waits on. Then ask whether to approve it, change it, or cancel it, and which tasks, if any, they want to accept themselves once done: none is unless they say, since reviews and checks confirm the work; it is worth it for a result only looking at it or trying it can judge.`,
      });
  for (const question of work.questions) {
    if (question.kind !== "decision" || question.decision.kind !== "delivery") continue;
    const subtask = work.subtasks.find((s) => s.id === question.subtaskId);
    const delivered = work.subtasks
      .filter((s) => s.taskId === subtask?.taskId && s.delivery)
      .map((s) => `- ${s.title}, by ${s.assignee}: ${s.delivery?.summary ?? ""}`);
    asked.push({
      key: `accept:${question.id}`,
      text: [
        `The task "${question.text}" is done [${question.id}], merged into its goal's branch:`,
        ...delivered,
        "Tell the user what was done, and ask whether to accept it or send it back with what to change (decide).",
      ].join("\n"),
    });
  }
  return asked;
}

/** How many tasks the band lists, one a line; more are counted. */
const BAND_TASKS = 5;

/** Where a task's work is, in words: the subtask under way, else the next one and what it waits on. */
function taskWhere(work: Work, derived: Derived, subtasks: Subtask[]): string | undefined {
  const at =
    subtasks.find(
      (s) => s.status === "running" || s.status === "reviewing" || s.status === "merging",
    ) ?? subtasks.find((s) => s.status !== "done");
  if (!at) return undefined;
  switch (at.status) {
    case "running":
      return `${at.assignee} ${underWay(at) ?? ""}`;
    case "reviewing":
    case "merging":
      return underWay(at);
    case "pending": {
      const [wait] = derived.subtasks[at.id]?.waits ?? [];
      return `"${at.title}" ${wait ? waitText(wait, work) : "starts next"}`;
    }
    default:
      return `"${at.title}" ${at.status}`;
  }
}

/**
 * The band's task lines, while the goal isn't archived: each task that isn't
 * done, with where it stands; one done that waits for you to accept it says so.
 */
function taskLines(work: Work, derived: Derived): string[] {
  const lines: string[] = [];
  if (work.goal.status === "archived") return lines;
  for (const task of work.tasks) {
    const subtasks = work.subtasks.filter((s) => s.taskId === task.id);
    const accepting = work.questions.some(
      (q) =>
        q.kind === "decision" &&
        q.decision.kind === "delivery" &&
        subtasks.some((s) => s.id === q.subtaskId),
    );
    const where = accepting ? "waits for you to accept it" : taskWhere(work, derived, subtasks);
    if (where) lines.push(`${task.title} · ${where}`);
  }
  return lines.length > BAND_TASKS
    ? [
        ...lines.slice(0, BAND_TASKS),
        `and ${plural(lines.length - BAND_TASKS, "more task", "more tasks")}`,
      ]
    : lines;
}

/** The band's words: what goes on in the goal and what waits on you. */
function bandText(work: Work, needs: number): string {
  const parts: string[] = [];
  if (work.meetings.some((m) => m.status === "running")) parts.push("meeting");
  if (work.meetings.some((m) => m.status === "review")) parts.push(PLAN_TO_REVIEW);
  const working = work.subtasks.filter((s) => s.status === "running").length;
  if (working) parts.push(`${String(working)} working`);
  if (needs) parts.push(`${plural(needs, "needs", "need")} you`);
  const { status } = work.goal;
  if (!parts.length) parts.push(status === "active" ? "idle" : status);
  return parts.join(" · ");
}

/** The band of a session without a goal: the goals it can take up, but those archived; nothing with none. */
function othersBand(others: readonly GoalEntry[]): string | undefined {
  const paused = others.filter((e) => whereOf(e) === "paused").length;
  const elsewhere = others.filter((e) => whereOf(e) === "in another session").length;
  const parts = [
    ...(paused ? [plural(paused, "goal paused", "goals paused")] : []),
    ...(elsewhere ? [`${plural(elsewhere, "goal", "goals")} in another session`] : []),
  ];
  return parts.length ? parts.join(" · ") : undefined;
}

/**
 * The team as the pane shows it: the session's goal (`mine`), if it runs
 * one, and the repository's goals it doesn't run (`others`).
 */
export function paneTeam(
  mine: { work: Work; members: readonly Member[] } | undefined,
  others: readonly GoalEntry[],
  moved: string | undefined,
): OpenplanTeam {
  if (!mine) {
    const band = othersBand(others);
    return {
      noGoal: noGoalText(moved),
      ...(band && { band }),
      tasks: [],
      members: [],
      needs: [],
      milestones: [],
      prompts: [],
      resumable: othersOf(others),
    };
  }
  const { work, members } = mine;
  const derived = derive(work);
  const needs = work.questions.filter(toYou).map((q) => needOf(q, work));
  const meeting = shownMeeting(work);
  const { goal } = work;
  const here =
    goal.status === "active"
      ? []
      : [{ slug: goal.slug, label: goalLabel(work, `${goal.status}, in this session`) }];
  return {
    goal: { name: goal.name, slug: goal.slug },
    band: bandText(work, needs.length),
    tasks: taskLines(work, derived),
    ...(meeting && { meeting: meetingOf(meeting, work) }),
    members: members.map((m) => memberOf(m, work, derived)),
    needs,
    milestones: milestones(work),
    prompts: prompts(work),
    resumable: [...here, ...othersOf(others)],
    ...(goal.status === "active" && { resumeRefused: resumeRefusal(goal.name) }),
  };
}

/** A tool call as its line names it. */
const callOf = (name: string, input: unknown): OpenplanCall => {
  const argument = mainArgument(input);
  return { name, ...(argument !== undefined && { argument }) };
};

/** A record's entries as the pane draws them: each tool call by its main argument. */
export const viewEntries = (entries: readonly RecordEntry[]): OpenplanEntry[] =>
  entries.map((entry) => {
    if (entry.kind !== "tool") return entry;
    const { input, name, ...rest } = entry;
    return { ...rest, ...callOf(name, input) };
  });

/** What a run does now, as the pane draws it. */
export const viewLive = (live: LiveRun): OpenplanLive => ({
  ...(live.streaming && { streaming: live.streaming }),
  ...(live.starting && { starting: live.starting }),
  running: live.running.map((call) => callOf(call.name, call.input)),
});

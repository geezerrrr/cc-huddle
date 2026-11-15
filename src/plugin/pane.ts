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
import {
  type DecisionOption,
  derive,
  type Derived,
  type GoalEntry,
  inProgress,
  type InProgress,
  type LiveRun,
  type Meeting,
  type Member,
  type NoteOption,
  PERMISSION_NOTE,
  type PermissionOption,
  type QuestionToYou,
  type RecordEntry,
  type Subtask,
  taskDone,
  toYou,
  type Work,
  type Notice,
  acceptanceOf,
  isAcceptance,
} from "../engine/index.ts";
import {
  attendanceText,
  goalLabel,
  mainArgument,
  meetingStatus,
  needWords,
  PLAN_TO_REVIEW,
  plural,
  resumableOf,
  waitText,
  whereOf,
  STATUS_WORDS,
  stepText,
  goalsWhere,
} from "./words.ts";

/** The meeting the pane shows: one under way, else one whose plan waits on you, else the latest. */
export function shownMeeting(work: Work): Meeting | undefined {
  const latest = (status?: Meeting["status"]) =>
    work.meetings.filter((m) => !status || m.status === status).at(-1);
  return latest("running") ?? latest("review") ?? latest();
}

function meetingOf(meeting: Meeting, work: Work): OpenplanMeeting {
  const now = work.meetingsNow[meeting.id];
  const hands = now?.hands ?? [];
  return {
    // Named by its goal: its agenda is the brief your session wrote for it, too long for a line.
    heading: `${work.goal.name} · ${meetingStatus(meeting, now)}`,
    attendance: attendanceText(meeting),
    agenda: meeting.agenda,
    turns: meeting.turns.map((t) => ({
      heading: t.calls ? `${t.speaker} → ${t.calls}` : t.speaker,
      text: t.text,
    })),
    ...(hands.length && {
      hands: `Hands up: ${hands.map((h) => `${h.member} (${h.point})`).join(", ")}`,
    }),
    ...(meeting.plan && { plan: `Plan: ${meeting.plan.summary}` }),
  };
}

/** The subtask a member's record follows: the one they work on, else the one they started last. */
export function followedOf(member: string, work: Work): Subtask | undefined {
  const own = work.subtasks.filter((s) => s.assignee === member);
  return (
    own.find((s) => s.status === "running") ??
    own.filter((s) => s.startedAt).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]
  );
}

function memberOf(member: Member, work: Work, derived: ReturnType<typeof derive>): OpenplanMember {
  const own = work.subtasks.filter((s) => s.assignee === member.name);
  const at = (...statuses: InProgress["status"][]) =>
    own.find((s): s is InProgress => inProgress(s) && statuses.includes(s.status));
  const reviewing = work.subtasks.find(
    (s) => s.assignee !== member.name && derived.subtasks[s.id]?.reviewedBy === member.name,
  );
  const meeting = work.meetings.find(
    (m) => m.status === "running" && m.participants.includes(member.name),
  );
  const next = own.find((s) => s.status === "pending");
  const running = at("running");
  const handedOver = at("reviewing", "waitingInReview") ?? at("merging", "waitingInMerge");
  let doing: string;
  if (running) doing = inProgressText(running);
  else if (meeting) doing = `at the meeting on "${work.goal.name}"`;
  else if (reviewing) doing = `reviews "${reviewing.title}" by ${reviewing.assignee}`;
  else if (handedOver) doing = inProgressText(handedOver);
  else if (next) {
    const waits = derived.subtasks[next.id]?.waits ?? [];
    doing = `next: "${next.title}"${waits.length ? `, ${waits.map((w) => waitText(w, work)).join(", ")}` : ""}`;
  } else doing = "free";
  const tokens = (work.tokens[member.name] ?? 0).toLocaleString();
  return {
    name: member.name,
    line: [member.role.title, ...(member.model ? [member.model] : []), `${tokens} tokens`].join(
      " · ",
    ),
    doing,
    followable: followedOf(member.name, work) !== undefined,
  };
}

/** An answer a need takes, labelled. */
const optionOf = (value: PermissionOption | DecisionOption) => ({
  value,
  label: OPTION_LABELS[value],
});

/**
 * The answers a need offers as buttons, and the one a note typed instead of
 * a pick goes with: one that is no answer without a note (`needed`) is only
 * the note's.
 */
function answersOf(
  options: readonly (PermissionOption | DecisionOption)[],
  note: { option: NoteOption; needed?: true } | undefined,
) {
  return {
    options: options.filter((o) => !(note?.needed && o === note.option)).map(optionOf),
    ...(note && {
      note: {
        option: note.option,
        label: OPTION_LABELS[note.option],
        prompt: NOTE_PROMPTS[note.option],
      },
    }),
  };
}

function needOf(question: QuestionToYou, work: Work): OpenplanNeed {
  const { headline, detail } = needWords(question, work);
  const head = {
    id: question.id,
    from: question.from,
    headline,
    ...(detail && { detail }),
    ask: !isAcceptance(question),
  };
  switch (question.kind) {
    case "permission": {
      const { options, note } = answersOf(question.permission.options, { option: PERMISSION_NOTE });
      return {
        ...head,
        kind: "options",
        options: options.map((o) => ({
          ...o,
          ...(o.value === "once" && { primary: true as const }),
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
          options: c.options.map((o) => ({
            label: o.label,
            ...(o.description && { description: o.description }),
          })),
          multiSelect: c.multiSelect,
        })),
      };
    case "decision": {
      const { kind } = question.decision;
      const subtask = work.subtasks.find((s) => s.id === question.subtaskId);
      const done = work.subtasks.filter((s) => s.taskId === subtask?.taskId && s.status === "done");
      return {
        ...head,
        kind: "options",
        ...answersOf(question.decision.options, question.decision.note),
        // With one done subtask, a revised task goes back to it: nothing to pick.
        ...(kind === "delivery" &&
          done.length > 1 && {
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
  for (const task of work.tasks)
    if (taskDone(work, task.id))
      said.push({ key: `task:${task.id}`, text: `The task "${task.title}" is done` });
  return said;
}

/** Where a prompt to your session points for what to do with it. */
const AS_THE_SKILL_SAYS = "Take it to the user as openplan's team skill says.";

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
        text: `The meeting [${meeting.id}] on "${work.goal.name}" has a plan for review: ${meeting.plan.summary}. ${AS_THE_SKILL_SAYS}`,
      });
  for (const question of work.questions) {
    if (!isAcceptance(question)) continue;
    const subtask = work.subtasks.find((s) => s.id === question.subtaskId);
    const delivered = work.subtasks
      .filter((s) => s.taskId === subtask?.taskId && s.delivery)
      .map((s) => `- ${s.title}, by ${s.assignee}: ${s.delivery?.summary ?? ""}`);
    asked.push({
      key: `accept:${question.id}`,
      text: [
        `The task "${question.text}" is done [${question.id}], merged into its goal's branch:`,
        ...delivered,
        AS_THE_SKILL_SAYS,
      ].join("\n"),
    });
  }
  return asked;
}

/** How many tasks the band lists, one a line; more are counted. */
const BAND_TASKS = 5;

/** Where a task's work is, in words: the subtask under way, else the next one and what it waits on. */
function taskWhere(work: Work, derived: Derived, subtasks: Subtask[]): string | undefined {
  const going = subtasks.find(inProgress);
  if (going)
    return going.status === "running"
      ? `${going.assignee} ${inProgressText(going)}`
      : inProgressText(going);
  const at = subtasks.find((s) => s.status !== "done");
  if (!at) return undefined;
  switch (at.status) {
    case "pending": {
      const [wait] = derived.subtasks[at.id]?.waits ?? [];
      return `"${at.title}" ${wait ? waitText(wait, work) : "starts next"}`;
    }
    default:
      return `"${at.title}" ${STATUS_WORDS[at.status]}`;
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
    const where = acceptanceOf(work, task.id)
      ? "waits for you to accept it"
      : taskWhere(work, derived, subtasks);
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
  const parts = (["paused", "elsewhere"] as const).flatMap((where) => {
    const count = others.filter((e) => whereOf(e) === where).length;
    return count ? [goalsWhere(count, where)] : [];
  });
  return parts.length ? parts.join(" · ") : undefined;
}

/** What you typed in a need's dialog answers none of it: it stays. */
const TYPED_ANSWERS_NONE = "openplan: what you typed answers none of it; it waits in Needs you";

/** Why `/openplan resume` takes nothing up when the repository has no goal this session doesn't run. */
const NOTHING_TO_RESUME = "No goal to resume.";

/**
 * The team as the pane shows it: the session's goal (`mine`), if it runs
 * one, and the repository's goals it doesn't run (`others`); `session`, the
 * goal that moved from it to another session, and how many it opened.
 */
export function paneTeam(
  mine: { work: Work; members: readonly Member[] } | undefined,
  others: readonly GoalEntry[],
  session: { moved: string | undefined; opened: number },
): OpenplanTeam {
  const { opened } = session;
  if (!mine) {
    const band = othersBand(others);
    const noGoal = noGoalText(session.moved);
    return {
      noGoal,
      opened,
      ...(band && { band }),
      tasks: [],
      members: [],
      needs: [],
      milestones: [],
      prompts: [],
      resumable: resumableOf(others),
      ...(!others.length && { resumeRefused: NOTHING_TO_RESUME }),
      pauseRefused: noGoal,
      typedAnswersNone: TYPED_ANSWERS_NONE,
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
    opened,
    band: bandText(work, needs.length),
    tasks: taskLines(work, derived),
    ...(meeting && { meeting: meetingOf(meeting, work) }),
    members: members.map((m) => memberOf(m, work, derived)),
    needs,
    milestones: milestones(work),
    prompts: prompts(work),
    resumable: [...here, ...resumableOf(others)],
    ...(goal.status === "active"
      ? { resumeRefused: resumeRefusal(goal.name) }
      : { pauseRefused: `"${goal.name}" isn't under way: it is ${goal.status}.` }),
    typedAnswersNone: TYPED_ANSWERS_NONE,
  };
}

/** A tool call as its line names it. */
const callOf = (name: string, input: unknown): OpenplanCall => {
  const argument = mainArgument(input);
  return { name, ...(argument !== undefined && { argument }) };
};

/** A record's entry as the pane draws it: a tool call by its main argument, a notice in words. */
function viewEntry(entry: RecordEntry): OpenplanEntry {
  switch (entry.kind) {
    case "run":
      return { kind: "run", text: `a run on ${entry.model}` };
    case "thinking":
    case "text":
      return { kind: entry.kind, text: entry.text };
    case "tool":
      return {
        kind: "tool",
        state: entry.state,
        output: entry.output,
        ...callOf(entry.name, entry.input),
      };
    case "steps":
      return { kind: "steps", steps: entry.steps };
    case "notice":
      return { kind: "notice", text: noticeText(entry.notice) };
  }
}

/** A record's entries as the pane draws them. */
export const viewEntries = (entries: readonly RecordEntry[]): OpenplanEntry[] =>
  entries.map(viewEntry);

/** What a run does now, as the pane draws it. */
export const viewLive = (live: LiveRun): OpenplanLive => ({
  ...(live.streaming && { streaming: live.streaming }),
  ...(live.starting && { starting: live.starting }),
  running: live.running.map((call) => callOf(call.name, call.input)),
});

/** What the Agent SDK reported while a run went on, in words. */
function noticeText(notice: Notice): string {
  const seconds = (ms: number) => `${String(Math.round(ms / 1000))}s`;
  switch (notice.kind) {
    case "retry":
      return `the API call failed: attempt ${String(notice.attempt)} of ${String(notice.max)} in ${seconds(notice.delayMs)}`;
    case "subagent-retry":
      return `a subagent's API call failed: attempt ${String(notice.attempt)} of ${String(notice.max)} in ${seconds(notice.delayMs)}`;
    case "compacted":
      return `the conversation was compacted from ${notice.before.toLocaleString()} tokens${notice.after === undefined ? "" : ` to ${notice.after.toLocaleString()}`}`;
    case "compaction-failed":
      return `compacting the conversation failed${notice.error ? `: ${notice.error}` : ""}`;
    case "fallback":
      return `${notice.from} declined: ${notice.to} goes on`;
    case "refusal":
      return `${notice.model} declined, with no model to go on`;
    case "task":
      return `background task "${notice.title}" ${notice.state}`;
    case "rate-limit":
      return notice.status === "rejected" ? "rate limited" : "close to the rate limit";
  }
}

/** A subtask in progress, in words: worked on and how far, or where it was handed over to. */
function inProgressText(subtask: InProgress): string {
  switch (subtask.status) {
    case "running": {
      const step = stepText(subtask.progress);
      return `works on "${subtask.title}"${step ? `, ${step}` : ""}`;
    }
    default:
      return `"${subtask.title}" ${STATUS_WORDS[subtask.status]}`;
  }
}

/** What each answer to a permission or a decision is called. */
const OPTION_LABELS: Record<PermissionOption | DecisionOption, string> = {
  once: "Allow once",
  always: "Always allow",
  deny: "Deny",
  rereview: "Review again",
  skip: "Skip the review",
  sendBack: "Send back",
  ours: "Keep ours",
  theirs: "Take theirs",
  retry: "Retry",
  stop: "Stop",
  accept: "Accept",
  revise: "Send back",
};

/** What a note typed instead of a pick says, for the option it goes with. */
const NOTE_PROMPTS: Record<NoteOption, string> = {
  deny: "Or deny it, saying why",
  sendBack: "Or send it back, saying what to change",
  revise: "What to change",
};

/**
 * Why a session runs no goal, and what to do, as the pane says it: `moved`,
 * the goal that moved to another session.
 */
const noGoalText = (moved: string | undefined) =>
  moved
    ? `"${moved}" moved to another Claude Code session. Bring it back here with /openplan resume.`
    : "This session runs no goal. Hand the team a task with /openplan <task>, or take a goal up with /openplan resume.";

/** Why `/openplan resume` takes nothing up while this session's goal (`name`) is under way. */
const resumeRefusal = (name: string) =>
  `"${name}" is under way in this session, which runs one goal: /openplan pause it first, or take the other up in another session.`;

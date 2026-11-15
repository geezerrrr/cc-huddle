/**
 * The team as openplan's pane shows it (docs/design.md §7.2), worked out here
 * from the state so the mod only draws: the band's words, the meeting, each
 * member at what they do, what waits on you with the answers it takes, the
 * milestones the transcript keeps, and what your session is asked to talk over.
 */
import type {
  OpenplanMeeting,
  OpenplanMember,
  OpenplanNeed,
  OpenplanTeam,
} from "../../plugin/types/index.d.ts";
import { derive, reviewerOf, type Work } from "../engine/derive.ts";
import {
  toYou,
  type Derived,
  type Member,
  type Meeting,
  type Permission,
  type QuestionToYou,
  type Subtask,
} from "../engine/types.ts";
import { stepText, waitText } from "./status.ts";

/**
 * What a meeting is about, in a line: its goal's name. Its agenda is the
 * brief your session wrote for it, too long for a line.
 */
function aboutOf(work: Work, meeting: Meeting): string {
  const goal = work.goals.find((g) => g.id === meeting.goalId);
  if (!goal) throw new Error(`The goal of the meeting [${meeting.id}] is gone`);
  return goal.name;
}

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

/** The meeting the pane shows: one under way, else one whose plan waits on you, else the latest. */
export function shownMeeting(work: Work): Meeting | undefined {
  const latest = (status?: Meeting["status"]) =>
    work.meetings.filter((m) => !status || m.status === status).at(-1);
  return latest("running") ?? latest("review") ?? latest();
}

function meetingStatus(meeting: Meeting): string {
  switch (meeting.status) {
    case "running":
      return meeting.planning
        ? `${meeting.host} writes the plan`
        : meeting.speaking
          ? `${meeting.speaking} speaks`
          : meeting.drafting
            ? "the members form their first judgments"
            : meeting.weighing
              ? "deciding who speaks next"
              : "under way";
    case "review":
      return "its plan waits for you";
    case "approved":
      return "plan approved";
    case "cancelled":
      return "cancelled";
    case "failed":
      return `failed${meeting.error ? `: ${meeting.error}` : ""}`;
  }
}

const meetingOf = (meeting: Meeting, work: Work): OpenplanMeeting => ({
  id: meeting.id,
  about: aboutOf(work, meeting),
  agenda: meeting.agenda,
  status: meetingStatus(meeting),
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
  let doing: string;
  if (running) {
    const step = stepText(running.progress);
    doing = `works on "${running.title}"${step ? `, ${step}` : ""}`;
  } else if (meeting) doing = `at the meeting on "${aboutOf(work, meeting)}"`;
  else if (reviewing) doing = `reviews "${reviewing.title}" by ${reviewing.assignee}`;
  else if (at("reviewing")) doing = `"${at("reviewing")?.title ?? ""}" is in review`;
  else if (at("merging")) doing = `"${at("merging")?.title ?? ""}" is being merged`;
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
    doing,
    ...(followed && { subtask: followed.id }),
    tokens: own.reduce((sum, s) => sum + s.tokens, 0) + spoken,
  };
}

/** A tool call in a line: Claude Code's own sentence for it, else the tool and its main argument. */
function callText(permission: Permission): string {
  if (permission.title) return permission.title;
  const { input } = permission;
  // As the mod's callLine reads a call in a member's record.
  const main = ["command", "file_path", "path", "pattern", "url", "description"]
    .map((key) => input[key])
    .find((value) => typeof value === "string");
  return main ? `${permission.tool}: ${main}` : permission.tool;
}

function needOf(question: QuestionToYou, work: Work): OpenplanNeed {
  const subtask = work.subtasks.find((s) => s.id === question.subtaskId);
  const head = {
    id: question.id,
    from: question.from,
    about: subtask?.title ?? "",
    text: question.text,
  };
  switch (question.kind) {
    case "permission":
      return {
        ...head,
        kind: "permission",
        call: callText(question.permission),
        options: question.permission.options,
      };
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
      const done = work.subtasks.filter((s) => s.taskId === subtask?.taskId && s.status === "done");
      return {
        ...head,
        kind: "decision",
        of: question.decision.kind,
        options: question.decision.options,
        ...(question.decision.kind === "delivery" && {
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
      said.push({ key: `plan:${meeting.id}`, text: `Plan approved: "${aboutOf(work, meeting)}"` });
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
        text: `The meeting [${meeting.id}] on "${aboutOf(work, meeting)}" has a plan: ${meeting.plan.summary}. Get it with show_plan and show it to the user in full: its document as it is written, then its tasks, each with its subtasks, who does them and what each waits on. Then ask whether to approve it, change it, or cancel it, and which tasks, if any, they want to accept themselves once done: none is unless they say, since reviews and checks confirm the work; it is worth it for a result only looking at it or trying it can judge.`,
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
      return `${at.assignee} works on "${at.title}"`;
    case "reviewing":
      return `"${at.title}" in review`;
    case "merging":
      return `"${at.title}" merging`;
    case "pending": {
      const [wait] = derived.subtasks[at.id]?.waits ?? [];
      return `"${at.title}" ${wait ? waitText(wait, work) : "starts next"}`;
    }
    default:
      return `"${at.title}" ${at.status}`;
  }
}

/**
 * The band's task lines: each task of a goal not archived that isn't done,
 * with where it stands; one done that waits for you to accept it says so.
 */
function taskLines(work: Work, derived: Derived): string[] {
  const lines: string[] = [];
  for (const task of work.tasks) {
    const goal = work.goals.find((g) => g.id === task.goalId);
    if (!goal || goal.status === "archived") continue;
    const subtasks = work.subtasks.filter((s) => s.taskId === task.id);
    const accepting = work.questions.some(
      (q) =>
        q.kind === "decision" &&
        q.decision.kind === "delivery" &&
        q.status === "open" &&
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

/** The band's words: what goes on and what waits on you; nothing before the first goal. */
function bandText(work: Work, needs: number): string | undefined {
  if (!work.goals.length) return undefined;
  const parts: string[] = [];
  if (work.meetings.some((m) => m.status === "running")) parts.push("meeting");
  if (work.meetings.some((m) => m.status === "review")) parts.push("plan to review");
  const working = work.subtasks.filter((s) => s.status === "running").length;
  if (working) parts.push(`${String(working)} working`);
  if (needs) parts.push(`${plural(needs, "needs", "need")} you`);
  if (!parts.length) {
    const paused = work.goals.filter((g) => g.status === "paused").length;
    parts.push(paused ? plural(paused, "goal paused", "goals paused") : "idle");
  }
  return parts.join(" · ");
}

/** The team as the pane shows it. */
export function paneTeam(work: Work, members: readonly Member[]): OpenplanTeam {
  const derived = derive(work);
  const needs = work.questions
    .filter(toYou)
    .filter((q) => q.status === "open")
    .map((q) => needOf(q, work));
  const meeting = shownMeeting(work);
  const band = bandText(work, needs.length);
  return {
    ...(band && { band }),
    tasks: taskLines(work, derived),
    ...(meeting && { meeting: meetingOf(meeting, work) }),
    members: members.map((m) => memberOf(m, work, derived)),
    needs,
    milestones: milestones(work),
    prompts: prompts(work),
  };
}

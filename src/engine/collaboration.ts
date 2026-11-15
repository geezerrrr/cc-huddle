/**
 * What a running member does with its team (docs/design.md §4.3): asks a
 * teammate, who answers in a read-only session in the goal's worktree, and
 * hands its work over, taken only once its files are there and the conflicts
 * a merge left are resolved.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { errorText } from "../shared/errors.ts";
import { ifThere } from "../shared/files.ts";
import { spend, type Core } from "./core.ts";
import { openGoal, unresolved } from "./git.ts";
import { DELIVERY_REFUSED, TEAMMATE_REPLIES, teammateQuestion } from "./prompts.ts";
import type { Questions } from "./questions.ts";
import type { Collaboration } from "./run.ts";
import { askOnce } from "./turns.ts";
import type { Member, Subtask } from "./types.ts";

/** How `from`'s run on `subtask`, in worktree `desk`, reaches its team until `signal` ends it. */
export function collaborationOf(
  core: Core,
  questions: Questions,
  run: { from: Member; subtask: Subtask; desk: string; signal: AbortSignal },
): Collaboration {
  return {
    askTeammate: (name, question) => askTeammate(core, questions, run, name, question),
    checkDelivery: (files) => checkDelivery(core, run.subtask, run.desk, files),
  };
}

/** A running member asks a teammate by name: what the asker is told. */
async function askTeammate(
  core: Core,
  questions: Questions,
  { from, subtask, signal }: { from: Member; subtask: Subtask; signal: AbortSignal },
  name: string,
  question: string,
): Promise<string> {
  const others = core.team.members.filter((m) => m.name !== from.name);
  const target = others.find((m) => m.name === name);
  if (!target)
    return name === from.name
      ? TEAMMATE_REPLIES.self
      : TEAMMATE_REPLIES.unknown(
          name,
          others.map((m) => m.name),
        );
  try {
    const reply = await questions.toTeammate(
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
          options: core.options(target, "readOnly", await openGoal(core.places)),
          signal,
          spent: (tokens) => {
            spend(core.state, target.name, tokens);
          },
        }),
    );
    core.changed();
    return TEAMMATE_REPLIES.answered(target.name, reply.text);
  } catch (error) {
    return TEAMMATE_REPLIES.failed(target.name, errorText(error));
  }
}

/** A delivery's files as taken, relative to the worktree, or why it isn't taken. */
async function checkDelivery(core: Core, subtask: Subtask, desk: string, files: string[]) {
  const kept: string[] = [];
  const missing: string[] = [];
  for (const file of files) {
    const relative = path.relative(desk, path.resolve(desk, file));
    const inside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    const there =
      inside && (await ifThere(stat(path.join(desk, relative)), undefined))?.isFile() === true;
    if (there) kept.push(relative.split(path.sep).join("/"));
    else missing.push(file);
  }
  if (missing.length) return { refused: DELIVERY_REFUSED.missing(desk, missing) };
  const left = subtask.conflict
    ? await unresolved(core.places, subtask.id, subtask.conflict.files)
    : [];
  if (left.length) return { refused: DELIVERY_REFUSED.conflicted(left) };
  return { files: [...new Set(kept)] };
}

/**
 * What a running member does with its team (docs/design.md §4.3): asks a
 * teammate, who answers in a read-only session in the goal's worktree.
 */
import { errorText } from "../shared/errors.ts";
import { spend, type Core } from "./core.ts";
import { openGoal } from "./git.ts";
import { TEAMMATE_REPLIES, teammateQuestion } from "./prompts.ts";
import type { Questions } from "./questions.ts";
import type { Collaboration } from "./run.ts";
import { askOnce } from "./turns.ts";
import type { Member, Subtask } from "./types.ts";

/** How `from`'s run on `subtask` reaches its team until `signal` ends it. */
export function collaborationOf(
  core: Core,
  questions: Questions,
  run: { from: Member; subtask: Subtask; signal: AbortSignal },
): Collaboration {
  return {
    askTeammate: (name, question) => askTeammate(core, questions, run, name, question),
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

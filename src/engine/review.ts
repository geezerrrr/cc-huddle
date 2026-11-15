/**
 * Reviewing a delivery (docs/design.md §4.3): a read-only session of the
 * reviewer's in the subtask's worktree judges what was delivered against its
 * acceptance criteria, and passes it or gives the notes it goes back with.
 */
import { z } from "zod";
import { spend, type Core } from "./core.ts";
import { reviewPrompt } from "./prompts.ts";
import { askOnce } from "./turns.ts";
import type { Delivery, Member, Subtask, Task } from "./types.ts";

/** A reviewer's verdict on a delivery. */
const verdictSchema = z.object({ pass: z.boolean(), notes: z.string().trim() });

export type Verdict = z.output<typeof verdictSchema>;

/** The reviewer's verdict on `subtask`'s delivery in its worktree `desk`; throws when the review gives none. */
export async function reviewDelivery(
  core: Core,
  review: {
    reviewer: Member;
    task: Task;
    subtask: Subtask;
    delivery: Delivery;
    desk: string;
    signal: AbortSignal;
  },
): Promise<Verdict> {
  const { reviewer, task, subtask, delivery, desk, signal } = review;
  const reply = await askOnce({
    prompt: reviewPrompt({ task, subtask, delivery, cwd: desk }),
    options: core.options(reviewer, "readOnly", desk),
    schema: verdictSchema,
    signal,
    spent: (tokens) => {
      spend(core.state, reviewer.name, tokens);
    },
  });
  return verdictSchema.parse(reply.structured);
}

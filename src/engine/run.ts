/**
 * A subtask's run (docs/design.md §4.3): the member's turns in its worktree
 * until it delivers. A turn that ends without delivering is reminded once in
 * the same session; a second fails the run.
 */
import { tool, type CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { errorText } from "../shared/errors.ts";
import type { MemberOptions } from "./policy.ts";
import { DELIVER_REMINDER, RUN_TOOLS, SESSION_ONLY } from "./prompts.ts";
import type { Handover } from "./types.ts";
import {
  keepingSession,
  runTurn,
  turnDecoder,
  turnServer,
  turnToolName,
  type TurnListener,
  withTurn,
} from "./turns.ts";
import { toolText } from "../shared/text.ts";

const OWN_TOOLS = new Set([turnToolName("ask_teammate"), turnToolName("deliver")]);

/** How a run reaches its teammates and hands its work over. */
export interface Collaboration {
  /** What the member is told back. */
  askTeammate(name: string, question: string): Promise<string>;
  /** A delivery's files as taken (relative to the worktree), or why it isn't taken. */
  checkDelivery(files: string[]): Promise<{ files: string[] } | { refused: string }>;
}

/** How a run ended: its work handed over, failed, or stopped. */
export type RunOutcome =
  | { status: "delivered"; handover: Handover; tokens: number }
  | { status: "failed"; error: string; tokens: number }
  | { status: "stopped"; tokens: number };

function teamServer(collaboration: Collaboration, delivered: (handover: Handover) => void) {
  return turnServer([
    tool(
      "ask_teammate",
      RUN_TOOLS.askTeammate.what,
      {
        teammate: z.string().describe(RUN_TOOLS.askTeammate.teammate),
        question: z.string().describe(RUN_TOOLS.askTeammate.question),
      },
      async ({ teammate, question }) =>
        toolText(await collaboration.askTeammate(teammate, question)),
    ),
    tool(
      "deliver",
      RUN_TOOLS.deliver.what,
      {
        summary: z.string().trim().min(1).describe(RUN_TOOLS.deliver.summary),
        files: z.array(z.string()).describe(RUN_TOOLS.deliver.files),
      },
      async ({ summary, files }) => {
        const checked = await collaboration.checkDelivery(files);
        if ("refused" in checked) return toolText(checked.refused);
        delivered({ summary, files: checked.files });
        return toolText(RUN_TOOLS.deliver.done);
      },
    ),
  ]);
}

/**
 * Runs a subtask from `opening` (its brief, or why it goes on in `resume`)
 * until it delivers, fails or `signal` stops it. Its own tools are allowed in
 * its session and refused to the subagents it starts; every other call goes
 * through `gate`.
 */
export async function runSubtask(params: {
  options: MemberOptions;
  opening: string;
  resume?: string;
  gate: CanUseTool;
  collaboration: Collaboration;
  listener: TurnListener;
  signal: AbortSignal;
}): Promise<RunOutcome> {
  const { options, gate, signal } = params;
  let handover: Handover | undefined;
  let session = params.resume;
  const decode = turnDecoder(keepingSession(params.listener, (id) => (session = id)));
  const canUseTool: CanUseTool = (name, input, request) => {
    if (!OWN_TOOLS.has(name)) return gate(name, input, request);
    return Promise.resolve(
      request.agentID
        ? { behavior: "deny", message: SESSION_ONLY }
        : { behavior: "allow", updatedInput: input },
    );
  };

  /** One turn: the opening, or the reminder, in the run's session. */
  const turn = (prompt: string) =>
    runTurn(
      prompt,
      withTurn(options, {
        ...(session !== undefined && { resume: session }),
        server: teamServer(params.collaboration, (given) => (handover = given)),
        canUseTool,
      }),
      signal,
      decode,
    );

  let tokens = 0;
  try {
    let outcome = await turn(params.opening);
    tokens += outcome.tokens;
    if (outcome.ok && !handover && !signal.aborted) {
      outcome = await turn(DELIVER_REMINDER);
      tokens += outcome.tokens;
    }
    // Handed over already: an error in the turn's last words doesn't take the work back.
    if (handover) return { status: "delivered", handover, tokens };
    if (signal.aborted) return { status: "stopped", tokens };
    return {
      status: "failed",
      error: outcome.ok ? "Ended without delivering, after a reminder" : outcome.error,
      tokens,
    };
  } catch (error) {
    if (handover) return { status: "delivered", handover, tokens };
    if (signal.aborted) return { status: "stopped", tokens };
    return { status: "failed", error: errorText(error), tokens };
  }
}

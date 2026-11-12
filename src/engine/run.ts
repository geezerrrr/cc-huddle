/**
 * A subtask's run (docs/design.md §4.3): the member's turns in its worktree
 * until it delivers. A turn that ends without delivering is reminded once in
 * the same session; a second fails the run.
 */
import {
  createSdkMcpServer,
  query,
  tool,
  type CanUseTool,
  type Options,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { errorText } from "./core.ts";
import { DELIVER_REMINDER, SESSION_ONLY } from "./prompts.ts";
import { claudeProcess, turnDecoder, type TurnListener, type TurnOutcome } from "./turns.ts";

/** The in-process MCP server a run's turns have: its tools are `mcp__openplan__<name>`. */
const SERVER = "openplan";
const OWN_TOOLS = new Set([`mcp__${SERVER}__ask_teammate`, `mcp__${SERVER}__deliver`]);

/** The work handed over: what was done, and its files, relative to the worktree. */
export interface Handover {
  summary: string;
  files: string[];
}

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

const text = (words: string) => ({ content: [{ type: "text" as const, text: words }] });

function teamServer(collaboration: Collaboration, delivered: (handover: Handover) => void) {
  return createSdkMcpServer({
    name: SERVER,
    tools: [
      tool(
        "ask_teammate",
        "Asks a teammate a question and waits for the answer. Use it only when you need their information or decision.",
        {
          teammate: z.string().describe("The teammate's name"),
          question: z.string().describe("The question, with the context they need"),
        },
        async ({ teammate, question }) => text(await collaboration.askTeammate(teammate, question)),
      ),
      tool(
        "deliver",
        "Hands over your finished work: your subtask is done only once you call it. Then end your turn. If you deliver again, the last delivery counts.",
        {
          summary: z
            .string()
            .trim()
            .min(1)
            .describe("A few sentences: what you did, and anything to watch out for"),
          files: z
            .array(z.string())
            .describe(
              "The files that are the result, as paths in your worktree (not scratch files); empty when the result is the summary itself",
            ),
        },
        async ({ summary, files }) => {
          const checked = await collaboration.checkDelivery(files);
          if ("refused" in checked) return text(checked.refused);
          delivered({ summary, files: checked.files });
          return text("Delivered. End your turn now.");
        },
      ),
    ],
  });
}

/**
 * Runs a subtask from `opening` (its brief, or why it goes on in `resume`)
 * until it delivers, fails or `signal` stops it. Its own tools are allowed in
 * its session and refused to the subagents it starts; every other call goes
 * through `gate`.
 */
export async function runSubtask(params: {
  options: Options;
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
  const decode = turnDecoder({
    ...params.listener,
    session: (id, model) => {
      session = id;
      params.listener.session?.(id, model);
    },
  });
  const canUseTool: CanUseTool = (name, input, request) => {
    if (!OWN_TOOLS.has(name)) return gate(name, input, request);
    return Promise.resolve(
      request.agentID
        ? { behavior: "deny", message: SESSION_ONLY }
        : { behavior: "allow", updatedInput: input },
    );
  };

  /** One turn: the opening, or the reminder, in the run's session. */
  const turn = async (prompt: string): Promise<TurnOutcome> => {
    const abortController = new AbortController();
    const stop = () => {
      abortController.abort();
    };
    signal.addEventListener("abort", stop, { once: true });
    const claude = claudeProcess();
    const run = query({
      prompt,
      options: {
        ...options,
        ...(session !== undefined && { resume: session }),
        mcpServers: {
          ...options.mcpServers,
          [SERVER]: teamServer(params.collaboration, (given) => (handover = given)),
        },
        canUseTool,
        abortController,
        spawnClaudeCodeProcess: claude.spawn,
      },
    });
    try {
      for await (const message of run) {
        const outcome = decode(message);
        if (outcome) return outcome;
      }
      return { ok: false, error: "The session ended without a result", tokens: 0 };
    } catch (error) {
      throw new Error(claude.failure(error), { cause: error });
    } finally {
      signal.removeEventListener("abort", stop);
      run.close();
      await claude.gone();
    }
  };

  let tokens = 0;
  try {
    signal.throwIfAborted();
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

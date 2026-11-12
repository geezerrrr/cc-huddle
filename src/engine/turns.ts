/**
 * Turns: one Agent SDK query each (docs/design.md §3.1). This is the one place
 * that reads what a turn's message stream says and judges how a turn ended.
 */
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

/** How a turn ended: its final text, or why it failed, and the tokens it used. */
export type TurnOutcome = (
  { ok: true; text: string; structured?: unknown; turns: number } | { ok: false; error: string }
) & { tokens: number };

/** All the tokens a usage counts: read fresh, read from the cache, written to it, and written out. */
const tokensOf = (usage: SDKResultMessage["usage"]) =>
  usage.input_tokens +
  usage.cache_read_input_tokens +
  usage.cache_creation_input_tokens +
  usage.output_tokens;

/**
 * How a turn ended, from its result message. A "success" with `is_error` is
 * a turn that ended on an API error, its text the error. The tokens are this
 * turn's main loop's (`usage`), plus `subagentTokens`; never `modelUsage`,
 * which in a resumed session carries the turns before it too.
 */
export function resultOutcome(message: SDKResultMessage, subagentTokens = 0): TurnOutcome {
  const tokens = tokensOf(message.usage) + subagentTokens;
  if (message.subtype === "success" && !message.is_error)
    return {
      ok: true,
      text: message.result,
      structured: message.structured_output,
      turns: message.num_turns,
      tokens,
    };
  const error =
    message.subtype === "success"
      ? message.result
      : message.subtype === "error_max_turns"
        ? `Stopped after ${String(message.num_turns)} turns, the most it may take`
        : message.subtype === "error_max_budget_usd"
          ? "Stopped at its spending limit"
          : message.subtype === "error_max_structured_output_retries"
            ? "The model didn't hand back a result in the shape asked for"
            : message.errors.join("\n");
  return { ok: false, error: error || "The turn failed without saying why", tokens };
}

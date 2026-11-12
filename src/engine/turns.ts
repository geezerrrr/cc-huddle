/**
 * Turns: one Agent SDK query each (docs/design.md §3.1). This is the one place
 * that reads what a turn's message stream says and judges how a turn ended.
 */
import type { SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

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

/** A tool call a turn made: what it was given and, once back, what it gave. */
export interface ToolCall {
  kind: "tool";
  id: string;
  name: string;
  input: unknown;
  state: "running" | "done" | "error";
  output?: string;
}

/** A whole block of a reply: thinking or words as they ended, or a tool call as it was made. */
export type Block = { kind: "thinking"; text: string } | { kind: "text"; text: string } | ToolCall;

/** Something the Agent SDK reports while a turn goes on. */
export type Notice =
  | { kind: "retry"; attempt: number; max: number; delayMs: number }
  | { kind: "compacted"; before: number; after?: number }
  | { kind: "compaction-failed"; error?: string }
  | { kind: "fallback"; from: string; to: string }
  | { kind: "refusal"; model: string }
  | { kind: "task"; state: "started" | "done" | "stopped" | "failed"; title: string }
  | { kind: "rate-limit"; status: "warning" | "rejected"; resetsAt?: number }
  | { kind: "subagent-retry"; attempt: number; max: number; delayMs: number };

/**
 * What a turn reports as it streams. Only the turn's own work: a subagent's
 * shows as the tool call that started it.
 */
export interface TurnListener {
  /** The session started, or was picked up: its id, and the model it runs on. */
  session?(id: string, model: string): void;
  /** A stretch of thinking began (""), or more of it came. */
  thinking?(delta: string): void;
  /** More of the reply's words; `fresh`: the first of a new message. */
  text?(delta: string, fresh: boolean): void;
  /** A tool call began, named before its input is whole. */
  toolStarting?(name: string): void;
  block?(block: Block): void;
  /** A tool call came back, done or failed, with what it gave. */
  toolDone?(call: ToolCall): void;
  notice?(notice: Notice): void;
}

/** A tool result's content as text: its words, and a mark for anything else in it (an image). */
function outputText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: { type?: unknown; text?: unknown }) =>
      part.type === "text" && typeof part.text === "string" ? part.text : `[${String(part.type)}]`,
    )
    .join("\n");
}

/**
 * Reads a turn's Agent SDK messages one by one, telling `listener` what they
 * hold. The turn's result message gives how it ended; every other message
 * gives undefined.
 */
export function turnDecoder(listener: TurnListener) {
  /** The calls made and not back yet. */
  const calls = new Map<string, ToolCall>();
  /** Tasks by id: the name they started under, for when they end. */
  const tasks = new Map<string, string>();
  /** The tokens the turn's subagents used, as each reported when it ended. */
  let subagentTokens = 0;
  /** No words of the message streaming yet. */
  let fresh = true;
  /** A text or thinking block is streaming: a notice must not cut its words. */
  let blockOpen = false;
  const held: Notice[] = [];
  const notify = (notice: Notice) => {
    if (blockOpen) held.push(notice);
    else listener.notice?.(notice);
  };
  const flush = () => {
    for (const notice of held.splice(0)) listener.notice?.(notice);
  };

  return (message: SDKMessage): TurnOutcome | undefined => {
    switch (message.type) {
      case "system":
        switch (message.subtype) {
          case "init":
            listener.session?.(message.session_id, message.model);
            return;
          case "api_retry":
            notify({
              kind: "retry",
              attempt: message.attempt,
              max: message.max_retries,
              delayMs: message.retry_delay_ms,
            });
            return;
          case "compact_boundary":
            notify({
              kind: "compacted",
              before: message.compact_metadata.pre_tokens,
              ...(message.compact_metadata.post_tokens !== undefined && {
                after: message.compact_metadata.post_tokens,
              }),
            });
            return;
          case "status":
            if (message.compact_result === "failed")
              notify({
                kind: "compaction-failed",
                ...(message.compact_error && { error: message.compact_error }),
              });
            return;
          case "model_refusal_fallback":
            notify({ kind: "fallback", from: message.original_model, to: message.fallback_model });
            return;
          case "model_refusal_no_fallback":
            notify({ kind: "refusal", model: message.original_model });
            return;
          case "task_started":
            tasks.set(message.task_id, message.description);
            // Housekeeping (a watcher, a skipped task) isn't part of what the turn did.
            if (message.skip_transcript || message.ambient) return;
            notify({ kind: "task", state: "started", title: message.description });
            return;
          case "task_notification":
            subagentTokens += message.usage?.total_tokens ?? 0;
            if (message.skip_transcript || message.ambient) return;
            notify({
              kind: "task",
              state:
                message.status === "completed"
                  ? "done"
                  : message.status === "stopped"
                    ? "stopped"
                    : "failed",
              title: tasks.get(message.task_id) ?? message.summary,
            });
            return;
          default:
            return;
        }
      case "result":
        flush();
        return resultOutcome(message, subagentTokens);
      case "rate_limit_event":
        if (message.rate_limit_info.status !== "allowed")
          notify({
            kind: "rate-limit",
            status: message.rate_limit_info.status === "rejected" ? "rejected" : "warning",
            ...(message.rate_limit_info.resetsAt !== undefined && {
              resetsAt: message.rate_limit_info.resetsAt,
            }),
          });
        return;
      case "tool_progress":
        if (message.subagent_retry)
          notify({
            kind: "subagent-retry",
            attempt: message.subagent_retry.attempt,
            max: message.subagent_retry.max_retries,
            delayMs: message.subagent_retry.retry_delay_ms,
          });
        return;
      case "stream_event": {
        if (message.parent_tool_use_id) return;
        const { event } = message;
        if (event.type === "message_start") {
          fresh = true;
          // A message cut off mid-block (a retry starts over) never ends it: what it held back goes now.
          blockOpen = false;
          flush();
        } else if (event.type === "content_block_start") {
          blockOpen =
            event.content_block.type === "thinking" || event.content_block.type === "text";
          if (event.content_block.type === "thinking") listener.thinking?.("");
          else if (event.content_block.type === "tool_use")
            listener.toolStarting?.(event.content_block.name);
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "thinking_delta") listener.thinking?.(event.delta.thinking);
          else if (event.delta.type === "text_delta") {
            listener.text?.(event.delta.text, fresh);
            fresh = false;
          }
        }
        return;
      }
      case "assistant":
        if (message.parent_tool_use_id) return;
        for (const block of message.message.content) {
          if (block.type === "thinking")
            listener.block?.({ kind: "thinking", text: block.thinking });
          else if (block.type === "text") listener.block?.({ kind: "text", text: block.text });
          else if (block.type === "tool_use") {
            const call: ToolCall = {
              kind: "tool",
              id: block.id,
              name: block.name,
              input: block.input,
              state: "running",
            };
            calls.set(call.id, call);
            listener.block?.(call);
          }
        }
        // The block just finished, so a notice held back for it comes after its words.
        blockOpen = false;
        flush();
        return;
      case "user": {
        if ("isReplay" in message || message.parent_tool_use_id) return;
        const { content } = message.message;
        if (typeof content === "string") return;
        for (const block of content) {
          const call = block.type === "tool_result" ? calls.get(block.tool_use_id) : undefined;
          if (block.type !== "tool_result" || !call) continue;
          calls.delete(call.id);
          listener.toolDone?.({
            ...call,
            output: outputText(block.content),
            state: block.is_error ? "error" : "done",
          });
        }
        return;
      }
      default:
        return;
    }
  };
}

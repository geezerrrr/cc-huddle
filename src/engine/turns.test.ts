import { query, type SDKMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { askOnce, claudeProcess, resultOutcome, turnDecoder, type TurnListener } from "./turns.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: vi.fn() }));

const usage = {
  input_tokens: 10,
  cache_read_input_tokens: 20,
  cache_creation_input_tokens: 30,
  output_tokens: 40,
};

/** A result message with the fields resultOutcome reads; the rest don't matter here. */
const result = (fields: Record<string, unknown>) =>
  ({ type: "result", num_turns: 3, usage, errors: [], ...fields }) as unknown as SDKResultMessage;

describe("resultOutcome", () => {
  it("reads a successful turn's text and counts every token of its usage", () => {
    expect(resultOutcome(result({ subtype: "success", is_error: false, result: "done" }))).toEqual({
      ok: true,
      text: "done",
      structured: undefined,
      tokens: 100,
    });
  });

  it("adds what subagents used", () => {
    const outcome = resultOutcome(result({ subtype: "success", is_error: false, result: "" }), 5);
    expect(outcome.tokens).toBe(105);
  });

  it("counts a success that is an API error as a failure", () => {
    const outcome = resultOutcome(
      result({ subtype: "success", is_error: true, result: "API Error: 529 overloaded" }),
    );
    expect(outcome).toMatchObject({ ok: false, error: "API Error: 529 overloaded" });
  });

  it("says why a turn stopped short", () => {
    expect(resultOutcome(result({ subtype: "error_max_turns" }))).toMatchObject({
      ok: false,
      error: "Stopped after 3 turns, the most it may take",
    });
    expect(
      resultOutcome(result({ subtype: "error_during_execution", errors: ["boom", "bang"] })),
    ).toMatchObject({ ok: false, error: "boom\nbang" });
  });

  it("gives a reason even when the turn gave none", () => {
    expect(resultOutcome(result({ subtype: "error_during_execution" }))).toMatchObject({
      ok: false,
      error: "The turn failed without saying why",
    });
  });
});

/** An SDK message with the fields the decoder reads. */
const msg = (fields: Record<string, unknown>) => fields as unknown as SDKMessage;
const event = (e: Record<string, unknown>, parent: string | null = null) =>
  msg({ type: "stream_event", parent_tool_use_id: parent, event: e });
const textStart = event({ type: "content_block_start", content_block: { type: "text", text: "" } });
const textDelta = (text: string) =>
  event({ type: "content_block_delta", delta: { type: "text_delta", text } });

/** A decoder whose listener records every call it gets, in order. */
function decoding() {
  const heard: unknown[][] = [];
  const listener = new Proxy({} as Required<TurnListener>, {
    get: (_, name: string) => vi.fn((...args: unknown[]) => heard.push([name, ...args])),
  });
  return { decode: turnDecoder(listener), heard };
}

describe("turnDecoder", () => {
  it("tells the session and the reply's words as they stream", () => {
    const { decode, heard } = decoding();
    decode(msg({ type: "system", subtype: "init", session_id: "s1", model: "glm-5" }));
    decode(event({ type: "message_start" }));
    decode(textStart);
    decode(textDelta("Hel"));
    decode(textDelta("lo"));
    expect(heard).toEqual([
      ["session", "s1", "glm-5"],
      ["text", "Hel", true],
      ["text", "lo", false],
    ]);
  });

  it("follows a tool call from its start to what it gave back", () => {
    const { decode, heard } = decoding();
    decode(
      event({ type: "content_block_start", content_block: { type: "tool_use", name: "Read" } }),
    );
    decode(
      msg({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }],
        },
      }),
    );
    decode(
      msg({
        type: "user",
        parent_tool_use_id: null,
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [{ type: "text", text: "line" }, { type: "image" }],
            },
          ],
        },
      }),
    );
    const call = { kind: "tool", id: "t1", name: "Read", input: { file_path: "a" } };
    expect(heard).toEqual([
      ["toolStarting", "Read"],
      ["block", { ...call, state: "running" }],
      ["toolDone", { ...call, state: "done", output: "line\n[image]" }],
    ]);
  });

  it("tells the turn's todo list when it writes one", () => {
    const { decode, heard } = decoding();
    const todos = [
      { content: "Draw the board", status: "completed", activeForm: "Drawing the board" },
      { content: "Add scores", status: "in_progress", activeForm: "Adding scores" },
    ];
    decode(
      msg({
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "tool_use", id: "t1", name: "TodoWrite", input: { todos } }] },
      }),
    );
    expect(heard.at(-1)).toEqual([
      "steps",
      [
        { content: "Draw the board", status: "completed" },
        { content: "Add scores", status: "in_progress" },
      ],
    ]);
  });

  it("leaves out what a subagent does inside its tool call", () => {
    const { decode, heard } = decoding();
    decode(textDelta("inside"));
    expect(heard).toHaveLength(1);
    decode(event({ type: "content_block_delta", delta: { type: "text_delta", text: "x" } }, "t1"));
    decode(msg({ type: "assistant", parent_tool_use_id: "t1", message: { content: [] } }));
    expect(heard).toHaveLength(1);
  });

  it("holds a notice back until the words it came in the middle of are whole", () => {
    const { decode, heard } = decoding();
    decode(textStart);
    decode(textDelta("half"));
    decode(
      msg({
        type: "system",
        subtype: "api_retry",
        attempt: 1,
        max_retries: 3,
        retry_delay_ms: 500,
      }),
    );
    expect(heard.map(([name]) => name)).toEqual(["text"]);
    decode(
      msg({
        type: "assistant",
        parent_tool_use_id: null,
        message: { content: [{ type: "text", text: "half" }] },
      }),
    );
    expect(heard.slice(1)).toEqual([
      ["block", { kind: "text", text: "half" }],
      ["notice", { kind: "retry", attempt: 1, max: 3, delayMs: 500 }],
    ]);
  });

  it("ends with the outcome, counting what its subagents used", () => {
    const { decode } = decoding();
    decode(
      msg({ type: "system", subtype: "task_started", task_id: "k", description: "Look around" }),
    );
    decode(
      msg({
        type: "system",
        subtype: "task_notification",
        task_id: "k",
        status: "completed",
        summary: "",
        usage: { total_tokens: 7 },
      }),
    );
    expect(decode(result({ subtype: "success", is_error: false, result: "ok" }))).toMatchObject({
      ok: true,
      tokens: 107,
    });
  });
});

describe("claudeProcess", () => {
  const run = (script: string) => {
    const claude = claudeProcess();
    const child = claude.spawn({
      command: process.execPath,
      args: ["-e", script],
      env: process.env,
      signal: new AbortController().signal,
    });
    child.stdin.end();
    child.stdout.resume();
    return claude;
  };

  it("waits until the process has exited", async () => {
    const claude = run("setTimeout(() => {}, 50)");
    await claude.gone();
    expect(claude.failure(new Error("stopped"))).toBe("stopped");
  });

  it("adds the end of what it wrote to stderr to a failure", async () => {
    const claude = run('process.stderr.write("x".repeat(3000) + "boom"); process.exit(1)');
    await claude.gone();
    const failure = claude.failure(new Error("Claude Code exited with code 1"));
    expect(failure).toMatch(/^Claude Code exited with code 1\. stderr: x+boom$/);
    expect(failure.length).toBeLessThan(2100);
  });
});

describe("askOnce", () => {
  /** The next query streams these messages. */
  const streams = (...messages: SDKMessage[]) => {
    const close = vi.fn();
    vi.mocked(query).mockReturnValueOnce(
      Object.assign(
        (async function* () {
          await Promise.resolve();
          yield* messages;
        })(),
        { close },
      ) as unknown as ReturnType<typeof query>,
    );
    return close;
  };
  const init = msg({ type: "system", subtype: "init", session_id: "s1", model: "glm-5" });
  const ask = (schema?: Record<string, unknown>, signal = new AbortController().signal) =>
    askOnce({ prompt: "Review it", options: { cwd: "/desk" }, schema, signal });

  it("gives the turn's words, its session and its tokens, and closes the query", async () => {
    const close = streams(
      init,
      result({ subtype: "success", is_error: false, result: "Looks good" }),
    );
    expect(await ask()).toEqual({ text: "Looks good", session: "s1", tokens: 100 });
    expect(close).toHaveBeenCalled();
  });

  it("asks for the schema's shape, and fails a turn that answers in words instead", async () => {
    streams(init, result({ subtype: "success", is_error: false, result: "pass" }));
    const schema = { type: "object" };
    await expect(ask(schema)).rejects.toThrow("answered in words");
    expect(vi.mocked(query).mock.lastCall?.[0].options).toMatchObject({
      cwd: "/desk",
      outputFormat: { type: "json_schema", schema },
    });
  });

  it("throws why the turn failed", async () => {
    streams(init, result({ subtype: "success", is_error: true, result: "API Error: 529" }));
    await expect(ask()).rejects.toThrow("API Error: 529");
  });

  it("starts nothing once stopped", async () => {
    vi.mocked(query).mockClear();
    await expect(ask(undefined, AbortSignal.abort())).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});

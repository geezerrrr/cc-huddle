import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { resultOutcome } from "./turns.ts";

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
      turns: 3,
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

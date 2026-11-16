import { query, type CanUseTool, type Options } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it, vi } from "vitest";
import { DELIVER_REMINDER } from "./prompts.ts";
import { runSubtask, type Collaboration } from "./run.ts";

// The server's tools as plain handlers, so a scripted turn can call them.
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
  tool: (name: string, _: string, __: unknown, handler: unknown) => ({ name, handler }),
  createSdkMcpServer: (server: unknown) => server,
}));

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[] }>;

/** A turn as a test scripts it: what it streams, calling the run's own tools as it goes. */
type Script = (turn: {
  prompt: string;
  options: Options;
  call: (name: string, args: Record<string, unknown>) => Promise<string>;
}) => AsyncGenerator<Record<string, unknown>> | Generator<Record<string, unknown>>;

/** Each query plays the next script; the prompts and options it was given are kept. */
function turns(...scripts: Script[]) {
  const seen: { prompt: string; options: Options }[] = [];
  vi.mocked(query).mockImplementation(({ prompt, options = {} }) => {
    seen.push({ prompt: prompt as string, options });
    const server = options.mcpServers?.huddle as unknown as {
      tools: { name: string; handler: Handler }[];
    };
    const call = async (name: string, args: Record<string, unknown>) => {
      const found = server.tools.find((t) => t.name === name);
      if (!found) throw new Error(`No tool ${name}`);
      return (await found.handler(args)).content.map((c) => c.text).join("");
    };
    const script = scripts.shift();
    if (!script) throw new Error("No turn scripted");
    const stream = script({ prompt: prompt as string, options, call });
    return Object.assign(stream, { close: vi.fn() }) as unknown as ReturnType<typeof query>;
  });
  return seen;
}

const usage = {
  input_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  output_tokens: 1,
};
const init = (session: string) => ({
  type: "system",
  subtype: "init",
  session_id: session,
  model: "m",
});
const done = (fields: Record<string, unknown> = {}) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "",
  num_turns: 1,
  usage,
  errors: [],
  ...fields,
});

const collaboration = (refuse?: string): Collaboration => ({
  askTeammate: (name, question) => Promise.resolve(`${name} answered ${question}`),
  checkDelivery: (files) => Promise.resolve(refuse ? { refused: refuse } : { files }),
});

const run = (fields: Partial<Parameters<typeof runSubtask>[0]> = {}) =>
  runSubtask({
    options: { cwd: "/desk", settings: "glm.json" },
    opening: "Your subtask: Scoreboard",
    gate: () => Promise.resolve({ behavior: "deny", message: "no" }),
    collaboration: collaboration(),
    listener: {},
    signal: new AbortController().signal,
    ...fields,
  });

describe("runSubtask", () => {
  it("delivers what the member hands over", async () => {
    turns(async function* ({ call }) {
      yield init("s1");
      expect(await call("ask_teammate", { teammate: "glm", question: "Font?" })).toBe(
        "glm answered Font?",
      );
      expect(await call("deliver", { summary: "Scores drawn", files: ["score.ts"] })).toBe(
        "Delivered. End your turn now.",
      );
      yield done();
    });
    expect(await run()).toEqual({
      status: "delivered",
      handover: { summary: "Scores drawn", files: ["score.ts"] },
      tokens: 2,
    });
  });

  it("reminds a member who ended without delivering once, in the same session", async () => {
    const seen = turns(
      function* () {
        yield init("s1");
        yield done();
      },
      async function* ({ call }) {
        await call("deliver", { summary: "Done now", files: [] });
        yield done();
      },
    );
    expect(await run()).toMatchObject({ status: "delivered", tokens: 4 });
    expect(seen.map((t) => [t.prompt, t.options.resume])).toEqual([
      ["Your subtask: Scoreboard", undefined],
      [DELIVER_REMINDER, "s1"],
    ]);
  });

  it("fails when it still hasn't delivered, or the delivery was refused", async () => {
    const silent: Script = async function* ({ call }) {
      yield init("s1");
      expect(await call("deliver", { summary: "Here", files: ["nope.ts"] })).toBe("Not there");
      yield done();
    };
    turns(silent, silent);
    expect(await run({ collaboration: collaboration("Not there") })).toEqual({
      status: "failed",
      error: "Ended without delivering, after a reminder",
      tokens: 4,
    });
  });

  it("fails with the turn's error", async () => {
    turns(function* () {
      yield done({ is_error: true, result: "API Error: 529" });
    });
    expect(await run({ resume: "s0" })).toMatchObject({
      status: "failed",
      error: "API Error: 529",
    });
  });

  it("stops when its signal does", async () => {
    const stop = new AbortController();
    turns(function* () {
      yield init("s1");
      stop.abort();
      throw new Error("aborted");
    });
    expect(await run({ signal: stop.signal })).toEqual({ status: "stopped", tokens: 0 });
  });

  it("allows its own tools in its session only, and puts every other call to the gate", async () => {
    let canUseTool: CanUseTool | undefined;
    turns(async function* ({ options, call }) {
      canUseTool = options.canUseTool;
      await call("deliver", { summary: "Done", files: [] });
      yield done();
    });
    const gate = vi.fn<CanUseTool>(() => Promise.resolve({ behavior: "allow" }));
    await run({ gate });
    const request = { signal: new AbortController().signal, toolUseID: "t", requestId: "r" };
    const own = "mcp__huddle__deliver";
    expect(await canUseTool?.(own, {}, request)).toEqual({ behavior: "allow", updatedInput: {} });
    expect(await canUseTool?.(own, {}, { ...request, agentID: "a1" })).toMatchObject({
      behavior: "deny",
    });
    await canUseTool?.("Bash", { command: "ls" }, request);
    expect(gate).toHaveBeenCalledWith("Bash", { command: "ls" }, request);
  });
});

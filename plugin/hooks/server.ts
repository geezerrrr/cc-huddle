/**
 * openplan's MCP server as the mod reaches it: its tools through
 * `$.mcp.call`, and the team through the pane's socket, which the `pane`
 * tool names.
 */
import type { EngineInterface } from "claude-code";
import type { OpenplanAsk, OpenplanView } from "../types";
import { PLUGIN } from "./state";

/** The session isn't in a repository: there are no goals to read until it is. */
export class NoRepository extends Error {}

/** The name `$.mcp.call` takes for openplan's server, once connected. */
let server: string | undefined;
/** The socket the server serves the pane's view on, once the `pane` tool named it. */
let socket: string | undefined;

/** Calls one of openplan's server's tools: its text, or its error thrown. */
export async function call(
  $: EngineInterface,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<string> {
  if (!server) {
    const connected = await $.mcp.connect(PLUGIN);
    if (!connected.isConnected) throw new Error(connected.message);
    server = connected.server;
  }
  const result = await $.mcp.call(server, tool, args);
  const text = result.content.find((block) => block.type === "text")?.text ?? "";
  if (result.isError) throw new Error(text);
  return text;
}

/**
 * The team as the server has it, through the pane's socket: not a tool call,
 * so your tool hooks don't run twice a second. A server started again has a
 * new socket, asked for after the old one fails.
 */
export async function view($: EngineInterface, ask: OpenplanAsk): Promise<OpenplanView> {
  socket ??= await call($, "pane");
  let response;
  try {
    response = await $.http.fetch("http://openplan/view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ask),
      socketPath: socket,
    });
  } catch (error) {
    socket = undefined;
    throw error;
  }
  if (response.status === 409) throw new NoRepository(response.text);
  if (!response.ok) throw new Error(response.text);
  return JSON.parse(response.text) as OpenplanView;
}

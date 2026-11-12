/**
 * openplan's MCP server (docs/design.md §3.2, §3.3). Claude Code starts it
 * with your session and ends it with the session; it runs the team of the
 * repository the session is in, and gives your session its tools.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import plugin from "../../plugin/.claude-plugin/plugin.json" with { type: "json" };
import { errorText } from "../engine/core.ts";
import { Engine } from "../engine/engine.ts";
import { stopMembers } from "../engine/processes.ts";
import { executableOf } from "./claude.ts";
import { pluginId } from "./plugin-id.ts";
import { addPaneTools } from "./pane-tools.ts";
import { addTools } from "./tools.ts";
import { NewForYou, wakeSession } from "./wake.ts";

const dataFolder = process.env.CLAUDE_PLUGIN_DATA;
if (!dataFolder)
  throw new Error("openplan's MCP server runs in Claude Code, which gives it CLAUDE_PLUGIN_DATA");

const say = (text: string) => {
  console.error(`openplan: ${text}`);
};

let engine: Engine | undefined;
let opening: Promise<Engine> | undefined;
/** What needs a conversation, since the team opened. */
let news: NewForYou | undefined;

/** The Claude Code your session runs, which members run too: the process that started this one. */
let claude: Promise<string> | undefined;

/** Opens the team of the repository the session is in. */
const openTeam = async () =>
  Engine.open({
    cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    dataFolder,
    claude: await (claude ??= executableOf(process.ppid)),
    session: process.ppid,
    plugin: pluginId(dataFolder),
    env: process.env,
    host: {
      changed() {
        if (!engine || !news) return;
        for (const message of news.news(engine.state))
          wakeSession(message).catch((error: unknown) => {
            say(`your session couldn't be told: ${errorText(error)}`);
          });
      },
      failed(error) {
        say(`the team's state or a record couldn't be written: ${errorText(error)}`);
      },
    },
  });

/** The team, opened on first need: again after it failed, as its files may have been fixed since. */
const team = (): Promise<Engine> => {
  opening ??= openTeam().then(
    (opened) => {
      news = new NewForYou(opened.state);
      return (engine = opened);
    },
    (error: unknown) => {
      opening = undefined;
      throw error;
    },
  );
  return opening;
};

let ending: Promise<void> | undefined;

/** Ends with the session: the team closes (§3.2), then this process. */
function end() {
  ending ??= (async () => {
    try {
      await (await opening?.catch(() => undefined))?.close();
    } catch (error) {
      say(`the team didn't close cleanly: ${errorText(error)}`);
    } finally {
      process.exit(0);
    }
  })();
}

process.stdin.once("end", end).once("close", end);
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.once(signal, end);
process.on("uncaughtException", (error) => {
  say(`stopped by an error: ${error.stack ?? error.message}`);
  engine?.abandon();
  process.exit(1);
});
process.once("exit", stopMembers);

const server = new McpServer({ name: "openplan", version: plugin.version });
addTools(server, team);
addPaneTools(server, team);
await server.connect(new StdioServerTransport());
// Opened now, so the session finds its team as it stands; a tool says why, if it can't be.
team().catch((error: unknown) => {
  say(errorText(error));
});

/**
 * openplan's MCP server (docs/design.md §3.2, §3.3). Claude Code starts it
 * with your session and ends it with the session; it runs the team of the
 * repository the session is in, and gives your session its tools and the
 * pane its socket.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import plugin from "../../plugin/.claude-plugin/plugin.json" with { type: "json" };
import { errorText } from "../engine/core.ts";
import { Engine } from "../engine/engine.ts";
import { stopMembers } from "../engine/processes.ts";
import { userTeamFolder } from "../engine/team.ts";
import { executableOf } from "./claude.ts";
import { dataFolder } from "./data-folder.ts";
import { pluginId } from "./plugin-id.ts";
import { servePane } from "./pane-server.ts";
import { addPaneTools } from "./pane-tools.ts";
import { addTools } from "./tools.ts";

const say = (text: string) => {
  console.error(`openplan: ${text}`);
};

let engine: Engine | undefined;
let opening: Promise<Engine> | undefined;

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
    userTeam: userTeamFolder(process.env),
    env: process.env,
    teamRead: listMembers,
    failed(error) {
      say(`the team's state or a record couldn't be written: ${errorText(error)}`);
    },
  });

/** The team, opened on first need: again after it failed, as its files may have been fixed since. */
const team = (): Promise<Engine> => {
  opening ??= openTeam().then(
    (opened) => (engine = opened),
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

const pane = await servePane(team);
process.once("exit", () => {
  pane.close();
});

const server = new McpServer({ name: "openplan", version: plugin.version });
const listMembers = addTools(server, team);
addPaneTools(server, team, pane);
await server.connect(new StdioServerTransport());
// Opened now, so the session finds its team as it stands; a tool says why, if it can't be.
team().catch((error: unknown) => {
  say(errorText(error));
});

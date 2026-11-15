/**
 * openplan's MCP server (docs/design.md §3.2, §3.3). Claude Code starts it
 * with your session and ends it with the session; it runs the goal your
 * session starts or takes up, and gives your session its tools and the pane
 * its socket.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import plugin from "../../plugin/.claude-plugin/plugin.json" with { type: "json" };
import { errorText } from "../engine/core.ts";
import { openRepository } from "../engine/git.ts";
import { stopMembers } from "../engine/processes.ts";
import { claudeFolder, loadTeam, userTeamFolder } from "../engine/team.ts";
import { executableOf } from "./claude.ts";
import { dataFolder } from "./data-folder.ts";
import { pluginIds } from "./plugin-id.ts";
import { askToLetGo, servePane } from "./pane-server.ts";
import { modeOf } from "./session-mode.ts";
import { addPaneTools } from "./pane-tools.ts";
import { Session } from "./session.ts";
import { addTools } from "./tools.ts";

const say = (text: string) => {
  console.error(`openplan: ${text}`);
};

const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const userTeam = userTeamFolder(process.env);
const plugins = await pluginIds(dataFolder, claudeFolder(process.env), cwd);

const pane = await servePane(() => session);

/** The Claude Code your session runs, which members run too: the process that started this one. */
let claude: Promise<string> | undefined;

const session: Session = new Session(
  {
    cwd,
    dataFolder,
    session: process.ppid,
    address: pane.address,
    takeOver: (holder, slug) =>
      askToLetGo(holder.address, slug).catch((error: unknown) => {
        throw new Error(
          `The Claude Code session that runs this goal (pid ${String(holder.session)}) couldn't be asked to let it go: ${errorText(error)}`,
          { cause: error },
        );
      }),
    sessionMode: () => modeOf(dataFolder, process.ppid),
    plugins,
    userTeam,
    env: process.env,
    failed(error) {
      say(`the goal's state or a record couldn't be written: ${errorText(error)}`);
    },
  },
  () =>
    (claude ??= executableOf(process.ppid).catch((error: unknown) => {
      // Found again next time.
      claude = undefined;
      throw error;
    })),
  (engine) => {
    if (engine) listMembers(engine.team);
    else void listTeamFiles();
  },
);

let ending: Promise<void> | undefined;

/** Ends with the session: its goal closes (§3.2), then this process. */
function end() {
  ending ??= (async () => {
    try {
      await session.close();
    } catch (error) {
      say(`the goal didn't close cleanly: ${errorText(error)}`);
    } finally {
      process.exit(0);
    }
  })();
}

process.stdin.once("end", end).once("close", end);
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.once(signal, end);
process.on("uncaughtException", (error) => {
  say(`stopped by an error: ${error.stack ?? error.message}`);
  session.current?.abandon();
  process.exit(1);
});
process.once("exit", stopMembers);
process.once("exit", () => {
  pane.close();
});

// openplan's prompts and tool results are in English, for the model; what it
// says to you follows your language, not theirs (§7.3).
const server = new McpServer(
  { name: "openplan", version: plugin.version },
  {
    instructions:
      "Talk to the user in the language they write to you in, whatever language openplan's messages and tool results are in.",
  },
);
const listMembers = addTools(server, session);
addPaneTools(server, session, pane);

/** Before a goal, the tools that name a member list the team as its files have it (§7.3). */
async function listTeamFiles() {
  try {
    const repo = await openRepository(cwd);
    listMembers((await loadTeam(userTeam, repo.top)).team);
  } catch {
    // No repository, or its team doesn't read yet (starting a goal says what is wrong): any name.
  }
}

await listTeamFiles();
await server.connect(new StdioServerTransport());

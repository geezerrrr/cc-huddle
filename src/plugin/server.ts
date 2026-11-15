/**
 * openplan's MCP server (docs/design.md §3.2, §3.3). Claude Code starts it
 * with your session and ends it with the session; it runs the team of the
 * repository the session is in while the session uses it, and gives your
 * session its tools and the pane its socket.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import plugin from "../../plugin/.claude-plugin/plugin.json" with { type: "json" };
import { errorText } from "../engine/core.ts";
import type { HandedOver } from "../engine/data.ts";
import { Engine } from "../engine/engine.ts";
import { stopMembers } from "../engine/processes.ts";
import { userTeamFolder } from "../engine/team.ts";
import { executableOf } from "./claude.ts";
import { dataFolder } from "./data-folder.ts";
import { pluginId } from "./plugin-id.ts";
import { askToLetGo, servePane } from "./pane-server.ts";
import { modeOf } from "./session-mode.ts";
import { addPaneTools } from "./pane-tools.ts";
import { addTools } from "./tools.ts";

const say = (text: string) => {
  console.error(`openplan: ${text}`);
};

let engine: Engine | undefined;
/** The team opening or open here, and whether it is taken over from a session that holds it. */
let opening: { engine: Promise<Engine>; take: boolean } | undefined;

/** The Claude Code your session runs, which members run too: the process that started this one. */
let claude: Promise<string> | undefined;

/** Opens the team of the repository the session is in; `take`, over from a session that holds it. */
const openTeam = async (take: boolean) =>
  Engine.open({
    cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    dataFolder,
    claude: await (claude ??= executableOf(process.ppid)),
    session: process.ppid,
    address: pane.address,
    ...(take && {
      takeOver: (holder) =>
        askToLetGo(holder.address).catch((error: unknown) => {
          throw new Error(
            `The Claude Code session that runs this repository's team (pid ${String(holder.session)}) couldn't be asked to let it go: ${errorText(error)}`,
            { cause: error },
          );
        }),
    }),
    sessionMode: () => modeOf(dataFolder, process.ppid),
    plugin: pluginId(dataFolder),
    userTeam: userTeamFolder(process.env),
    env: process.env,
    teamRead: listMembers,
    failed(error) {
      say(`the team's state or a record couldn't be written: ${errorText(error)}`);
    },
  });

/**
 * The team, opened on first need: again after it failed, as its files may
 * have been fixed since, or another session held it. Using openplan
 * (`take`) takes it over from a session that holds it; looking doesn't.
 */
async function team(take: boolean): Promise<Engine> {
  const was = (opening ??= {
    engine: openTeam(take).then(
      (opened) => (engine = opened),
      (error: unknown) => {
        opening = undefined;
        throw error;
      },
    ),
    take,
  });
  try {
    return await was.engine;
  } catch (error) {
    // A look found the team another session's, or that it moved there: this use takes it over.
    if (take && !was.take) {
      if (opening === was) opening = undefined;
      return team(take);
    }
    throw error;
  }
}

/**
 * Lets the team go to another session that takes it over (§3.2): what that
 * stopped, for it to resume. A look here doesn't open it again, even once
 * it is free: only using openplan here does.
 */
async function letGo(): Promise<HandedOver> {
  const held = await opening?.engine.catch(() => undefined);
  engine = undefined;
  if (!held) {
    opening = undefined;
    return { goals: [], meetings: [] };
  }
  const closing = held.close();
  const moved = closing.then(() => {
    throw new Error(
      "openplan's team moved to another Claude Code session. Using openplan here brings it back.",
    );
  });
  // Looked at only by those who ask for the team.
  moved.catch(() => undefined);
  opening = { engine: moved, take: false };
  return closing;
}

let ending: Promise<void> | undefined;

/** Ends with the session: the team closes (§3.2), then this process. */
function end() {
  ending ??= (async () => {
    try {
      await (await opening?.engine.catch(() => undefined))?.close();
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

const pane = await servePane(team, letGo);
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
// Your session's tools and the pane's answers are using openplan.
const use = () => team(true);
const listMembers = addTools(server, use);
addPaneTools(server, use, pane);
await server.connect(new StdioServerTransport());

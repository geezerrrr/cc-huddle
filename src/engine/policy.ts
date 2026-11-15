/**
 * The options of every member session (docs/design.md §6, §8), composed here
 * only. A member session is a Claude Code session of its own on your
 * repository: it loads your user and project settings like any session, and
 * runs under flag settings on top, which outrank both.
 */
import type { Options, PermissionMode, Settings } from "@anthropic-ai/claude-agent-sdk";
import { writeWhole } from "./files.ts";
import { authorEnv, memberSigner } from "./git.ts";
import type { Member } from "./types.ts";

type Env = Record<string, string | undefined>;

/**
 * The variables Claude Code gives its MCP server about the session it runs
 * in. A member is a session of its own: started with these, it would take
 * your session's inbox, id and effort.
 */
const SESSION_VARS = [
  "AI_AGENT",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_EFFORT",
  "CLAUDE_PLUGIN_DATA",
  "CLAUDE_PLUGIN_ROOT",
  "CLAUDE_PROJECT_DIR",
];

/** Built-in tools a read-only session has: meetings, answers to teammates, reviews. */
const READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "WebSearch", "WebFetch"];

/**
 * Fills in `${VAR}` and `${VAR:-default}` from `from`, as `.mcp.json` does.
 * A variable that is unset and has no default is an error naming it.
 */
export function expandEnv(env: Record<string, string>, from: Env): Record<string, string> {
  const missing = new Set<string>();
  const filled = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      value.replace(
        /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
        (_, name: string, fallback?: string) => {
          const found = from[name] ?? fallback;
          if (found === undefined) missing.add(name);
          return found ?? "";
        },
      ),
    ]),
  );
  if (missing.size) throw new Error(`Not set in the environment: ${[...missing].join(", ")}`);
  return filled;
}

/**
 * The flag settings a member's sessions run under: the team's settings, the
 * member's environment, and the guards every member has. No permission mode
 * or sandbox of openplan's own: what isn't the team's is your settings' and
 * your session's mode (workOptions). openplan is off in them, so a member
 * never starts a team of its own, and they take no message from your
 * sessions and send none.
 */
export function memberSettings(
  team: Settings,
  member: Member,
  from: Env,
  plugin: string,
): Settings {
  return {
    ...team,
    env: { ...team.env, ...expandEnv(member.env, from) },
    enabledPlugins: { ...team.enabledPlugins, [plugin]: false },
    crossSessionInbound: "refuse",
    permissions: {
      ...team.permissions,
      deny: [...(team.permissions?.deny ?? []), "SendMessage", "ListAgents"],
    },
  };
}

/**
 * Writes a member's settings to a file only you can read and gives its path:
 * settings passed inline end up on a command line, keys and all.
 */
export async function writeSettings(file: string, settings: Settings): Promise<string> {
  await writeWhole(file, JSON.stringify(settings), 0o600);
  return file;
}

/** Where and as whom a member's turn runs. */
export interface Seat {
  member: Member;
  /** The Claude Code they run. */
  claude: string;
  cwd: string;
  /** Their settings file (writeSettings). */
  settings: string;
  /** Appended to Claude Code's own system prompt. */
  system: string;
  /** Your session's permission mode, for a working turn; none when the team sets its own, or none is known yet. */
  mode?: PermissionMode;
}

/**
 * Agent SDK options for a member's working turn: their model and effort,
 * their settings file, your session's permission mode, Claude Code's system
 * prompt with ours appended, the reply streamed as it is written, their name
 * on the commits they make and in `claude agents`.
 */
export function workOptions(seat: Seat, from: Env): Options {
  const { member } = seat;
  const env = Object.fromEntries(
    Object.entries(from).filter(([name]) => !SESSION_VARS.includes(name)),
  );
  return {
    cwd: seat.cwd,
    model: member.model,
    effort: member.effort,
    settings: seat.settings,
    ...(seat.mode && {
      permissionMode: seat.mode,
      // The SDK takes bypassPermissions only so: your session runs in it, as you chose.
      ...(seat.mode === "bypassPermissions" && { allowDangerouslySkipPermissions: true }),
    }),
    env: { ...env, ...authorEnv(memberSigner(member.name)) },
    systemPrompt: { type: "preset", preset: "claude_code", append: seat.system },
    includePartialMessages: true,
    toolConfig: { askUserQuestion: { previewFormat: "markdown" } },
    extraArgs: { name: `openplan-${member.name}` },
    pathToClaudeCodeExecutable: seat.claude,
  };
}

/**
 * Options for a read-only turn: the member's own session and settings, kept
 * to the read-only tools. Nobody is there to approve anything, so what the
 * rules don't allow is refused (dontAsk). Not plan mode: it brings Claude
 * Code's planning workflow, which ends a turn with ExitPlanMode, at odds with
 * a turn that has to end in structured output (a meeting's plan).
 *
 * No MCP server but the turn's own (strictMcpConfig): yours would offer tools
 * that do more than read, and as a resumed session connects them partway
 * through each turn, its tools change and the conversation's prompt cache is
 * written again whole, turn after turn.
 */
export function readOnlyOptions(seat: Seat, from: Env): Options {
  return {
    ...workOptions(seat, from),
    tools: READ_ONLY_TOOLS,
    permissionMode: "dontAsk",
    strictMcpConfig: true,
  };
}

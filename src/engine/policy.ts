/**
 * The options of every member session (docs/design.md §6, §8), composed here
 * only. A member session is a Claude Code session of its own on your
 * repository: it loads your user and project settings like any session, and
 * runs under flag settings on top, which outrank both.
 */
import type { Options, PermissionMode, Settings } from "@anthropic-ai/claude-agent-sdk";
import { errorText } from "../shared/errors.ts";
import { writeWhole } from "../shared/files.ts";
import { authorEnv, memberSigner } from "./git.ts";
import type { SessionKind } from "./prompts.ts";
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
  plugins: readonly string[],
): Settings {
  return {
    ...team,
    env: { ...team.env, ...expandEnv(member.env, from) },
    enabledPlugins: {
      ...team.enabledPlugins,
      ...Object.fromEntries(plugins.map((id) => [id, false])),
    },
    crossSessionInbound: "refuse",
    permissions: {
      ...team.permissions,
      deny: [...(team.permissions?.deny ?? []), "SendMessage", "ListAgents"],
    },
  };
}

/**
 * Each member's flag settings (memberSettings), by name. Throws, naming the
 * member, when their environment names a variable that isn't set.
 */
export function teamSettings(
  team: Settings,
  members: readonly Member[],
  from: Env,
  plugins: readonly string[],
): (readonly [string, Settings])[] {
  return members.map((member) => {
    try {
      return [member.name, memberSettings(team, member, from, plugins)] as const;
    } catch (error) {
      throw new Error(`${member.name}: ${errorText(error)}`, { cause: error });
    }
  });
}

/**
 * Writes a member's settings to a file only you can read: settings passed
 * inline end up on a command line, keys and all.
 */
export async function writeSettings(file: string, settings: Settings): Promise<void> {
  await writeWhole(file, JSON.stringify(settings), 0o600);
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
  /** Your session's permission mode as it is now; undefined before it is known. */
  sessionMode?: PermissionMode;
  /** The team's settings: a permission mode of their own wins over yours. */
  team: Settings;
}

/** A member turn's options: always with its settings file, which tells its process from others (processes.ts). */
export type MemberOptions = Options & { settings: string };

/** The options of a member's turn of `kind`: working (workOptions) or reading only (readOnlyOptions). */
export const sessionOptions = (seat: Seat, kind: SessionKind, from: Env): MemberOptions =>
  kind === "work" ? workOptions(seat, from) : readOnlyOptions(seat, from);

/**
 * Agent SDK options for a member's working turn: their model and effort,
 * their settings file, your session's permission mode unless the team sets
 * its own, Claude Code's system
 * prompt with ours appended, the reply streamed as it is written, their name
 * on the commits they make and in `claude agents`.
 */
function workOptions(seat: Seat, from: Env): MemberOptions {
  const teamMode = seat.team.permissions?.defaultMode !== undefined;
  return memberOptions(seat, from, teamMode ? undefined : seat.sessionMode);
}

/** What every member turn runs with, in permission mode `mode` (Claude Code's default for none). */
function memberOptions(seat: Seat, from: Env, mode: PermissionMode | undefined): MemberOptions {
  const { member } = seat;
  const env = Object.fromEntries(
    Object.entries(from).filter(([name]) => !SESSION_VARS.includes(name)),
  );
  return {
    cwd: seat.cwd,
    model: member.model,
    effort: member.effort,
    settings: seat.settings,
    ...(mode && {
      permissionMode: mode,
      // The SDK takes bypassPermissions only so: your session runs in it, as you chose.
      ...(mode === "bypassPermissions" && { allowDangerouslySkipPermissions: true }),
    }),
    env: { ...env, ...authorEnv(memberSigner(member.name)) },
    systemPrompt: { type: "preset", preset: "claude_code", append: seat.system },
    includePartialMessages: true,
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
function readOnlyOptions(seat: Seat, from: Env): MemberOptions {
  return {
    ...memberOptions(seat, from, "dontAsk"),
    tools: READ_ONLY_TOOLS,
    strictMcpConfig: true,
  };
}

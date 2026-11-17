/**
 * The team as you write it (docs/design.md §6), in your own `huddle/`
 * folder beside Claude Code's user settings and in the repository's
 * `.claude/huddle/`: the members and the team's settings in `team.yaml`, the
 * roles as Markdown files, and the Claude Code settings every member works
 * under.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { EffortLevel, Settings } from "@anthropic-ai/claude-agent-sdk";
import { parse, parseDocument } from "yaml";
import { z } from "zod";
import { type Team } from "./core.ts";
import { errorCode, errorText } from "../shared/errors.ts";
import { ifThere, jsonIfThere, namesIfThere, writeWhole } from "../shared/files.ts";
import { serialBy } from "../shared/serial.ts";
import { type GoalSettings, MEETING_SIZES, type Member, type Role } from "./types.ts";

/** The team's folder in a repository. */
export const teamFolder = (top: string) => path.join(top, ".claude", "huddle");

/** Claude Code's user folder, as it finds it. */
export const claudeFolder = (env: Record<string, string | undefined>) =>
  env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude");

/** Your own team's folder, for every repository: in Claude Code's user folder. */
export const userTeamFolder = (env: Record<string, string | undefined>) =>
  path.join(claudeFolder(env), "huddle");

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const satisfies EffortLevel[];

const settingsSchema = z.record(z.string(), z.unknown());

const roleSchema = z.object({ title: z.string().trim().min(1).optional() });

const memberSchema = z.object({
  role: z.string().trim().min(1),
  model: z.string().trim().min(1).optional(),
  effort: z.enum(EFFORTS).optional(),
  // As in `.mcp.json`, though YAML reads `API_TIMEOUT_MS: 3000000` as a number.
  env: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]).transform(String))
    .default({}),
  settings: settingsSchema.optional(),
});

const teamSchema = z.object({
  review: z.boolean().optional(),
  meeting: z.enum(MEETING_SIZES).optional(),
  parallel: z.boolean().optional(),
  // `members:` with every member commented out, as shipped, is null.
  members: z
    .record(z.string(), memberSchema)
    .nullish()
    .transform((members) => members ?? {}),
});

/** The team's settings (§6.1) as `team.yaml` names them, and as a goal keeps them. */
const SETTING_KEYS = {
  review: "review",
  meeting: "meetingSize",
  parallel: "parallel",
} as const satisfies Record<string, keyof GoalSettings>;

const DEFAULT_SETTINGS: GoalSettings = { review: true, meetingSize: "discussion", parallel: false };

/** The team's settings a `team.yaml` sets, as a goal keeps them. */
function settingsIn(file: z.output<typeof teamSchema>): Partial<GoalSettings> {
  const set: Partial<Record<keyof GoalSettings, unknown>> = {};
  for (const [key, setting] of Object.entries(SETTING_KEYS))
    if (file[key as keyof typeof SETTING_KEYS] !== undefined)
      set[setting] = file[key as keyof typeof SETTING_KEYS];
  return set as Partial<GoalSettings>;
}

/** The team and the settings its members work under. */
export interface TeamFiles {
  team: Team;
  settings: Settings;
}

/** The team as its files have it now: with the team's settings a goal started now takes (§6.1). */
export interface LoadedTeam extends TeamFiles {
  goalSettings: GoalSettings;
}

/** What is wrong with the team's files, naming the file; a `settings.json` that isn't JSON throws a SyntaxError instead. */
export class TeamError extends Error {}

/** Throws why a file's contents don't fit, naming the file. */
function parsed<T>(schema: z.ZodType<T>, data: unknown, file: string): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new TeamError(`${file}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/** YAML as data, or what is wrong with it, naming the file. */
function yamlIn(text: string, file: string): unknown {
  try {
    return parse(text) ?? {};
  } catch (error) {
    throw new TeamError(`${file}: ${errorText(error)}`, { cause: error });
  }
}

/** The roles in a `roles/` folder, by file name: front matter and the duties after it. */
async function roleFiles(folder: string) {
  const names = (await namesIfThere(folder)).filter((name) => name.endsWith(".md")).sort();
  return Promise.all(
    names.map(async (name): Promise<[string, Role]> => {
      const file = path.join(folder, name);
      const text = await readFile(file, "utf8");
      const front = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
      const id = name.slice(0, -".md".length);
      const { title } = parsed(roleSchema, yamlIn(front?.[1] ?? "", file), file);
      // Comments explain the file, as shipped (§6): never duties.
      const duties = text
        .slice(front?.[0].length ?? 0)
        .replace(/<!--[\s\S]*?-->/g, "")
        .trim();
      return [id, { title: title ?? id, duties }];
    }),
  );
}

/**
 * Settings over settings, as Claude Code merges its own scopes: objects key
 * by key, arrays joined without repeats, anything else replaced.
 */
export function mergeSettings(under: object, over: object): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...under };
  for (const [key, value] of Object.entries(over)) {
    const was = merged[key];
    merged[key] =
      Array.isArray(was) && Array.isArray(value)
        ? [...new Set([...(was as unknown[]), ...(value as unknown[])])]
        : isObject(was) && isObject(value)
          ? mergeSettings(was, value)
          : value;
  }
  return merged;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A `team.yaml` read, or empty where there is none; throws what is wrong with it, naming it. */
async function teamFile(folder: string) {
  const file = path.join(folder, "team.yaml");
  const text = await ifThere(readFile(file, "utf8"), "");
  return parsed(teamSchema, yamlIn(text, file), file);
}

/**
 * Reads the team from your folder (`userTeam`), then the repository's (at
 * `top`): a member, role or team setting the repository has replaces yours,
 * and settings merge as Claude Code's do. A role with no file is its name
 * alone. Throws what is wrong with a file, naming it.
 */
export async function loadTeam(userTeam: string, top: string): Promise<LoadedTeam> {
  const roles = new Map<string, Role>();
  const written = new Map<string, z.output<typeof memberSchema>>();
  let settings: Record<string, unknown> = {};
  let goalSettings = DEFAULT_SETTINGS;
  const folders = [userTeam, teamFolder(top)];
  for (const folder of folders) {
    for (const [id, role] of await roleFiles(path.join(folder, "roles"))) roles.set(id, role);
    const file = await teamFile(folder);
    goalSettings = { ...goalSettings, ...settingsIn(file) };
    for (const [name, member] of Object.entries(file.members)) written.set(name, member);
    const settingsFile = path.join(folder, "settings.json");
    settings = mergeSettings(
      settings,
      parsed(settingsSchema, (await jsonIfThere(settingsFile)) ?? {}, settingsFile),
    );
  }
  const byName = [...written].sort(([a], [b]) => (a < b ? -1 : 1));
  const members = byName.map(([name, { role, model, effort, env, settings: own }]): Member => ({
    name,
    role: roles.get(role) ?? { title: role, duties: "" },
    ...(model !== undefined && { model }),
    ...(effort !== undefined && { effort }),
    env,
    ...(own !== undefined && { settings: own }),
  }));
  if (!members.length)
    throw new TeamError(
      `The team has no members: list them in ${folders.map((f) => path.join(f, "team.yaml")).join(" or ")}`,
    );
  return { team: { members }, settings, goalSettings };
}

/**
 * Switches team settings in your `team.yaml` (§6.1), keeping its comments,
 * for goals started after: those the repository's `team.yaml` doesn't set.
 * Gives those it does, which yours doesn't decide.
 */
export function switchInTeam(
  userTeam: string,
  top: string,
  change: Partial<GoalSettings>,
): Promise<(keyof GoalSettings)[]> {
  const file = path.join(userTeam, "team.yaml");
  return writing(file, async () => {
    const theirs = settingsIn(await teamFile(teamFolder(top)));
    const held = (Object.keys(change) as (keyof GoalSettings)[]).filter((k) => k in theirs);
    const yours = Object.entries(SETTING_KEYS).filter(
      ([, setting]) => change[setting] !== undefined && !held.includes(setting),
    );
    if (!yours.length) return held;
    await teamFile(userTeam);
    const doc = parseDocument(await ifThere(readFile(file, "utf8"), ""));
    for (const [key, setting] of yours) doc.set(key, change[setting]);
    await writeWhole(file, doc.toString());
    return held;
  });
}

/** The files cc-huddle ships in your team's folder (§6): examples to edit, explained in comments. */
const SHIPPED: Record<string, string> = {
  "team.yaml": `# Your cc-huddle team, for every repository. A repository's own
# .claude/huddle/team.yaml adds members and overrides these settings.

# Another member reviews each delivery before it merges.
review: true
# How long a meeting's discussion runs: small, discussion or large.
meeting: discussion
# Whether a member does several pieces of work at once.
parallel: false

# The members, each by name. Uncomment one and edit it.
members:
#   sonnet:
#     role: developer       # the angle it sees the work from: a name, and roles/<role>.md if you write one
#     model: sonnet         # the model it runs on; your session's when left out
#     effort: high          # low, medium, high, xhigh or max
#     settings:             # Claude Code settings of its own, over settings.json
#       permissions:
#         allow: ["Bash(pnpm test *)"]
#   glm:
#     role: designer
#     model: glm-5.3-flashx
#     env:                  # what its Claude Code runs with; \${VAR} comes from your environment
#       ANTHROPIC_BASE_URL: https://open.bigmodel.cn/api/anthropic
#       ANTHROPIC_AUTH_TOKEN: \${GLM_API_KEY}
`,
  [path.join("roles", "developer.md")]: `<!--
A role file: what your team keeps to in this role, its own conventions and
what it never does. Every member whose role is "developer" reads it, at the
meeting and in their work. A role with no file is its name alone.

Write below this comment; comments aren't read. Front matter at the very top
may give the role a title:

---
title: Developer
---
-->
`,
  "settings.json": `${JSON.stringify({ permissions: { allow: [], ask: [], deny: [] } }, null, 2)}\n`,
};

/** Writes each file cc-huddle ships that is missing from your team's folder (`userTeam`); one that is there is never touched. */
export async function shipTeam(userTeam: string): Promise<void> {
  for (const [name, text] of Object.entries(SHIPPED)) {
    const file = path.join(userTeam, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text, { flag: "wx" }).catch((error: unknown) => {
      if (errorCode(error) !== "EEXIST") throw error;
    });
  }
}

/** One write to the team's settings at a time, so no rule added is lost to another. */
const writing = serialBy();

/** Settings with allow rules added, everything else in them kept; `file` is where they are, for what is wrong with them. */
function allowing(settings: Record<string, unknown>, rules: readonly string[], file: string) {
  const permissions = parsed(
    z.looseObject({ allow: z.array(z.string()).default([]) }),
    settings.permissions ?? {},
    file,
  );
  const allow = [...new Set([...permissions.allow, ...rules])];
  return { ...settings, permissions: { ...permissions, allow } };
}

/** Adds allow rules to the repository's team `settings.json`, keeping everything else in it, for goals started after (§6). */
export function allowInTeam(top: string, rules: readonly string[]): Promise<void> {
  const file = path.join(teamFolder(top), "settings.json");
  return writing(file, async () => {
    const settings = parsed(settingsSchema, (await jsonIfThere(file)) ?? {}, file);
    await writeWhole(file, `${JSON.stringify(allowing(settings, rules, file), null, 2)}\n`);
  });
}

/**
 * Writes a goal's copy of the team (§6) to `file`: as read when it started,
 * each member's `env` as written, its `${VAR}`s not filled in.
 */
export const copyTeam = (file: string, { team, settings }: TeamFiles) =>
  writeWhole(file, JSON.stringify({ team, settings }));

/** A goal's copy of the team, from its file (copyTeam). */
export async function readCopy(file: string): Promise<TeamFiles> {
  return JSON.parse(await readFile(file, "utf8")) as TeamFiles;
}

/** Adds allow rules to a goal's copy of the team, for its members' next turns; gives the copy as it is now. */
export function allowInCopy(file: string, rules: readonly string[]): Promise<TeamFiles> {
  return writing(file, async () => {
    const copy = await readCopy(file);
    const settings = allowing(copy.settings, rules, file) as Settings;
    const now = { ...copy, settings };
    await copyTeam(file, now);
    return now;
  });
}

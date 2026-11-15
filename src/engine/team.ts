/**
 * The team as you write it (docs/design.md §6), in your own `openplan/`
 * folder beside Claude Code's user settings and in the repository's
 * `.claude/openplan/`: roles and members as Markdown files with front matter,
 * the Claude Code settings every member works under, and openplan's own.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { EffortLevel, Settings } from "@anthropic-ai/claude-agent-sdk";
import { parse } from "yaml";
import { z } from "zod";
import { type Team } from "./core.ts";
import { errorText } from "../shared/errors.ts";
import { writeWhole, jsonIfThere, namesIfThere } from "../shared/files.ts";
import { serialBy } from "../shared/serial.ts";
import { MEETING_SIZES, type MeetingSize, type Member, type Role } from "./types.ts";

/** The team's folder in a repository. */
export const teamFolder = (top: string) => path.join(top, ".claude", "openplan");

/** Claude Code's user folder, as it finds it. */
export const claudeFolder = (env: Record<string, string | undefined>) =>
  env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude");

/** Your own team's folder, for every repository: in Claude Code's user folder. */
export const userTeamFolder = (env: Record<string, string | undefined>) =>
  path.join(claudeFolder(env), "openplan");

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const satisfies EffortLevel[];

const roleSchema = z.object({ title: z.string().trim().min(1) });

const memberSchema = z.object({
  role: z.string().trim().min(1),
  model: z.string().trim().min(1).optional(),
  effort: z.enum(EFFORTS).optional(),
  // As in `.mcp.json`, though YAML reads `API_TIMEOUT_MS: 3000000` as a number.
  env: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]).transform(String))
    .default({}),
});

const teamSchema = z.object({
  review: z.boolean().optional(),
  meetingSize: z.enum(MEETING_SIZES).optional(),
});

const settingsSchema = z.record(z.string(), z.unknown());

/** The team, the settings its members work under, and the size a meeting has unless you say. */
export interface TeamFiles {
  team: Team;
  settings: Settings;
  meetingSize: MeetingSize;
}

/** Throws why a file's contents don't fit, naming the file. */
function parsed<T>(schema: z.ZodType<T>, data: unknown, file: string): T {
  const result = schema.safeParse(data);
  if (!result.success) throw new Error(`${file}:\n${z.prettifyError(result.error)}`);
  return result.data;
}

/** The Markdown files in a folder, by name: their front matter and the text after it. */
async function markdownFiles(folder: string) {
  const names = (await namesIfThere(folder)).filter((name) => name.endsWith(".md")).sort();
  return Promise.all(
    names.map(async (name) => {
      const file = path.join(folder, name);
      const text = await readFile(file, "utf8");
      const front = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(text);
      let data: unknown;
      try {
        data = parse(front?.[1] ?? "") ?? {};
      } catch (error) {
        throw new Error(`${file}: ${errorText(error)}`, { cause: error });
      }
      return {
        name: name.slice(0, -".md".length),
        file,
        data,
        body: text.slice(front?.[0].length ?? 0),
      };
    }),
  );
}

/**
 * Settings over settings, as Claude Code merges its own scopes: objects key
 * by key, arrays joined without repeats, anything else replaced.
 */
function mergeSettings(
  under: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...under };
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

/**
 * Reads the team from your folder (`userTeam`), then the repository's (at
 * `top`): a
 * role or member the repository has by the same name replaces yours, its
 * `team.json` fields replace yours, and settings merge as Claude Code's do.
 * Throws what is wrong with a file, naming it.
 */
export async function loadTeam(userTeam: string, top: string): Promise<TeamFiles> {
  const roles = new Map<string, Role>();
  const written = new Map<string, { file: string; data: unknown }>();
  let own: z.infer<typeof teamSchema> = {};
  let settings: Record<string, unknown> = {};
  const folders = [userTeam, teamFolder(top)];
  for (const folder of folders) {
    for (const { name, file, data, body } of await markdownFiles(path.join(folder, "roles")))
      roles.set(name, {
        id: name,
        title: parsed(roleSchema, data, file).title,
        duties: body.trim(),
      });
    for (const { name, file, data } of await markdownFiles(path.join(folder, "members")))
      written.set(name, { file, data });
    const teamFile = path.join(folder, "team.json");
    own = { ...own, ...parsed(teamSchema, (await jsonIfThere(teamFile)) ?? {}, teamFile) };
    const settingsFile = path.join(folder, "settings.json");
    settings = mergeSettings(
      settings,
      parsed(settingsSchema, (await jsonIfThere(settingsFile)) ?? {}, settingsFile),
    );
  }
  const byName = [...written].sort(([a], [b]) => (a < b ? -1 : 1));
  const members = byName.map(([name, { file, data }]): Member => {
    const { role, model, effort, env } = parsed(memberSchema, data, file);
    const found = roles.get(role);
    if (!found) throw new Error(`${file}: there is no role "${role}" in the team's roles/`);
    return {
      name,
      role: found,
      ...(model !== undefined && { model }),
      ...(effort !== undefined && { effort }),
      env,
    };
  });
  if (!members.length)
    throw new Error(
      `The team has no members: add them in ${folders.map((f) => path.join(f, "members")).join(" or ")}`,
    );
  return {
    team: { members, review: own.review ?? true },
    settings,
    meetingSize: own.meetingSize ?? "discussion",
  };
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
export const copyTeam = (file: string, team: TeamFiles) => writeWhole(file, JSON.stringify(team));

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

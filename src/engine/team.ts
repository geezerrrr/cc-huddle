/**
 * The team as you write it (docs/design.md §6), in `.claude/openplan/` in
 * the repository: roles and members as Markdown files with front matter,
 * the Claude Code settings every member works under, and openplan's own.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { EffortLevel, Settings } from "@anthropic-ai/claude-agent-sdk";
import { parse } from "yaml";
import { z } from "zod";
import { errorText, type Team } from "./core.ts";
import { writeWhole } from "./files.ts";
import { serialBy } from "./serial.ts";
import { MEETING_SIZES, type MeetingSize, type Member, type Role } from "./types.ts";

/** The team's folder in a repository. */
export const teamFolder = (top: string) => path.join(top, ".claude", "openplan");

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
  review: z.boolean().default(true),
  meetingSize: z.enum(MEETING_SIZES).default("discussion"),
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

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** A JSON file's contents; undefined when there is no such file. */
async function jsonFile(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file}: ${errorText(error)}`, { cause: error });
  }
}

/** The Markdown files in a folder, by name: their front matter and the text after it. */
async function markdownFiles(folder: string) {
  let names: string[];
  try {
    names = (await readdir(folder)).filter((name) => name.endsWith(".md")).sort();
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
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

/** Reads the team from a repository, or throws what is wrong with its files. */
export async function loadTeam(top: string): Promise<TeamFiles> {
  const folder = teamFolder(top);
  const roles = new Map<string, Role>(
    (await markdownFiles(path.join(folder, "roles"))).map(({ name, file, data, body }) => [
      name,
      { id: name, title: parsed(roleSchema, data, file).title, duties: body.trim() },
    ]),
  );
  const members = (await markdownFiles(path.join(folder, "members"))).map(
    ({ name, file, data }): Member => {
      const { role, model, effort, env } = parsed(memberSchema, data, file);
      const found = roles.get(role);
      if (!found)
        throw new Error(`${file}: there is no role "${role}" in ${path.join(folder, "roles")}`);
      return {
        name,
        role: found,
        ...(model !== undefined && { model }),
        ...(effort !== undefined && { effort }),
        env,
      };
    },
  );
  if (!members.length)
    throw new Error(`The team has no members: add them in ${path.join(folder, "members")}`);
  const teamFile = path.join(folder, "team.json");
  const { review, meetingSize } = parsed(teamSchema, (await jsonFile(teamFile)) ?? {}, teamFile);
  const settingsFile = path.join(folder, "settings.json");
  const settings = parsed(settingsSchema, (await jsonFile(settingsFile)) ?? {}, settingsFile);
  return { team: { members, review }, settings, meetingSize };
}

/** One write to the team's settings at a time, so no rule added is lost to another. */
const writing = serialBy();

/**
 * Adds allow rules to the team's `settings.json`, keeping everything else in
 * it, for every member's turns from then on.
 */
export function allowInTeam(top: string, rules: readonly string[]): Promise<void> {
  const file = path.join(teamFolder(top), "settings.json");
  return writing(file, async () => {
    const settings = parsed(settingsSchema, (await jsonFile(file)) ?? {}, file);
    const permissions = parsed(
      z.looseObject({ allow: z.array(z.string()).default([]) }),
      settings.permissions ?? {},
      file,
    );
    const allow = [...new Set([...permissions.allow, ...rules])];
    await writeWhole(
      file,
      `${JSON.stringify({ ...settings, permissions: { ...permissions, allow } }, null, 2)}\n`,
    );
  });
}

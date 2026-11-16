/**
 * The settings goals start with (docs/design.md §6.1): in the data folder,
 * for all your repositories, switched as `/model` is, by `/huddle review` and
 * `/huddle meeting`.
 */
import path from "node:path";
import { z } from "zod";
import { type GoalSettings, MEETING_SIZES } from "../engine/index.ts";
import { jsonIfThere, writeWhole } from "../shared/files.ts";

const FILE = "defaults.json";

const defaultsSchema = z.object({
  review: z.boolean().default(true),
  meetingSize: z.enum(MEETING_SIZES).default("discussion"),
}) satisfies z.ZodType<GoalSettings>;

/** The settings a goal started now takes. */
export async function readDefaults(dataFolder: string): Promise<GoalSettings> {
  return defaultsSchema.parse((await jsonIfThere(path.join(dataFolder, FILE))) ?? {});
}

/** Keeps `settings` for goals started after. */
export function writeDefaults(dataFolder: string, settings: GoalSettings): Promise<void> {
  return writeWhole(path.join(dataFolder, FILE), JSON.stringify(settings));
}

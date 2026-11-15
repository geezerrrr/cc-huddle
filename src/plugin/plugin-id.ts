/**
 * The ids openplan goes by in `enabledPlugins` (`openplan@<marketplace>`),
 * to turn off in members' sessions. Its data folder is named after the id
 * that loaded it, with every character but letters, digits, `_` and `-`
 * turned into `-`; a marketplace's name may have a `.`, which doesn't read
 * back, so every openplan id your settings files enable is turned off too.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { errorCode } from "../engine/core.ts";

const PLUGIN = "openplan";

/** The id read back from the data folder: right unless the marketplace's name has a `.`. */
const pluginId = (dataFolder: string) =>
  `${PLUGIN}@${path.basename(dataFolder).slice(PLUGIN.length + 1)}`;

/** The openplan ids a settings file enables or disables; none when it is missing or doesn't parse, as Claude Code skips it then. */
async function idsIn(file: string): Promise<string[]> {
  let settings: { enabledPlugins?: Record<string, unknown> };
  try {
    settings = JSON.parse(await readFile(file, "utf8")) as typeof settings;
  } catch (error) {
    if (error instanceof SyntaxError || errorCode(error) === "ENOENT") return [];
    throw error;
  }
  return Object.keys(settings.enabledPlugins ?? {}).filter((id) => id.startsWith(`${PLUGIN}@`));
}

/**
 * Every id of openplan's to turn off: the one read back from `dataFolder`,
 * and those in your user settings (in `configFolder`) and the project's (at
 * `projectFolder`).
 */
export async function pluginIds(
  dataFolder: string,
  configFolder: string,
  projectFolder: string,
): Promise<string[]> {
  const files = [
    path.join(configFolder, "settings.json"),
    path.join(projectFolder, ".claude", "settings.json"),
    path.join(projectFolder, ".claude", "settings.local.json"),
  ];
  const found = await Promise.all(files.map(idsIn));
  return [...new Set([pluginId(dataFolder), ...found.flat()])];
}

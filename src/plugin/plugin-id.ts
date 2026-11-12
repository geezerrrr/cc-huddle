/**
 * openplan's id as `enabledPlugins` names it (`openplan@<marketplace>`),
 * read back from its data folder, which Claude Code names after the id with
 * every character but letters, digits, `_` and `-` turned into `-`.
 */
import path from "node:path";

const PLUGIN = "openplan";

export function pluginId(dataFolder: string): string {
  return `${PLUGIN}@${path.basename(dataFolder).slice(PLUGIN.length + 1)}`;
}

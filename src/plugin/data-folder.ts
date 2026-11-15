/**
 * openplan's data folder: Claude Code gives it to the plugin's MCP server and
 * hooks. Only you may read it: goals' state, records and team copies hold
 * what members said, did and were given.
 */
import { chmodSync, mkdirSync } from "node:fs";

const folder = process.env.CLAUDE_PLUGIN_DATA;
if (!folder) throw new Error("openplan runs in Claude Code, which gives it CLAUDE_PLUGIN_DATA");
mkdirSync(folder, { recursive: true });
chmodSync(folder, 0o700);

export const dataFolder: string = folder;

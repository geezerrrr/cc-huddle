/** openplan's data folder: Claude Code gives it to the plugin's MCP server and hooks. */
const folder = process.env.CLAUDE_PLUGIN_DATA;
if (!folder) throw new Error("openplan runs in Claude Code, which gives it CLAUDE_PLUGIN_DATA");

export const dataFolder: string = folder;

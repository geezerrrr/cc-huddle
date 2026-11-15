/**
 * The permission mode hook: Claude Code runs it as you send a message and as
 * your session calls one of openplan's tools, with the session's permission
 * mode, which it keeps for the session's members (session-mode.ts).
 */
import { text } from "node:stream/consumers";
import { dataFolder } from "./data-folder.ts";
import { keepMode } from "./session-mode.ts";

const input = JSON.parse(await text(process.stdin)) as { permission_mode: string };
// Claude Code starts the hook itself.
await keepMode(dataFolder, process.ppid, input.permission_mode);

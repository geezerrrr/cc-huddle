/**
 * The SessionStart hook: Claude Code runs it as a session starts, resumes or
 * is cleared, and adds what it prints to the session's context.
 */
import { text } from "node:stream/consumers";
import { sessionContext } from "./context.ts";

const input = JSON.parse(await text(process.stdin)) as { cwd: string };
const dataFolder = process.env.CLAUDE_PLUGIN_DATA;
const context = dataFolder && (await sessionContext(input.cwd, dataFolder));
if (context)
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
    }),
  );

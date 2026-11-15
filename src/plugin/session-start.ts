/**
 * The SessionStart hook: Claude Code runs it as a session starts, resumes or
 * is cleared, and adds what it prints to the session's context.
 */
import { text } from "node:stream/consumers";
import { sessionContext } from "./context.ts";
import { dataFolder } from "./data-folder.ts";

const input = JSON.parse(await text(process.stdin)) as { cwd: string };
// Claude Code starts the hook itself.
const context = await sessionContext(input.cwd, dataFolder, process.ppid);
if (context)
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
    }),
  );

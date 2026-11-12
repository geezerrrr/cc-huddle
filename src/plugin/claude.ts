/**
 * The Claude Code your session runs, which members run too (docs/design.md
 * §3.2): the same version and install, and nothing else of its own to ship.
 * The MCP server's parent is your session's process; the system tells which
 * executable it runs.
 */
import { execFile } from "node:child_process";
import { readlink } from "node:fs/promises";
import { promisify } from "node:util";

const run = async (command: string, args: string[]) =>
  (await promisify(execFile)(command, args)).stdout;

/** The executable process `pid` runs. */
export async function executableOf(pid: number): Promise<string> {
  const id = String(pid);
  let found: string | undefined;
  switch (process.platform) {
    case "linux":
      found = await readlink(`/proc/${id}/exe`);
      break;
    case "win32":
      found = (
        await run("powershell.exe", [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${id}").ExecutablePath`,
        ])
      ).trim();
      break;
    default:
      // The first text file lsof lists for a process is its executable.
      found = (await run("lsof", ["-a", "-p", id, "-d", "txt", "-Fn"]))
        .split("\n")
        .find((line) => line.startsWith("n"))
        ?.slice(1);
  }
  if (!found) throw new Error(`Can't tell which executable process ${id} runs`);
  return found;
}

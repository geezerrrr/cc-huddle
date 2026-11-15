/** Processes by pid: a leaf, for the MCP server's bootstrap too, before its dependencies are in. */
import { errorCode } from "./errors.ts";

/** Whether process `pid` runs. */
export function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === "ESRCH") return false;
    // There, but not ours to signal.
    if (errorCode(error) === "EPERM") return true;
    throw error;
  }
}

/** The command that prints a field of process `pid` on Windows (`CommandLine`, `ExecutablePath`). */
export const windowsProcessField = (pid: number, field: "CommandLine" | "ExecutablePath") =>
  [
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${String(pid)}").${field}`,
    ],
  ] as const;

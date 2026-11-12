/**
 * The Claude Code processes started for members (docs/design.md §3.2). One
 * MCP server runs one team, so these are this process's own: those running
 * are kept, to be stopped at once when it exits, and written down with the
 * settings file each runs under, so that a start after a server that was
 * killed outright stops what it left.
 */
import { execFile, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { writeWholeSync } from "./files.ts";

/** A member process as written down: its settings file tells it from another that got its pid. */
interface Written {
  pid: number;
  settings: string;
}

/** The member processes running, by pid. */
const running = new Map<number, { child: ChildProcess; settings: string }>();

/** The file they are written down in (recordMembersIn). */
let record: string | undefined;

/** Written as they start and end, in one go, so a file left by a crash is whole. */
function save() {
  if (record === undefined) return;
  const written: Written[] = [...running].map(([pid, { settings }]) => ({ pid, settings }));
  writeWholeSync(record, JSON.stringify(written));
}

/** Keeps a member's Claude Code while it runs. `args`: its command line, naming its settings file. */
export function watchMember(child: ChildProcess, args: readonly string[]) {
  const { pid } = child;
  const at = args.indexOf("--settings");
  const settings = at < 0 ? undefined : args[at + 1];
  if (pid === undefined || settings === undefined) return;
  running.set(pid, { child, settings });
  save();
  child.once("exit", () => {
    running.delete(pid);
    save();
  });
}

/** Stops every member process still running, as this process exits. */
export function stopMembers() {
  for (const { child } of running.values()) child.kill("SIGTERM");
}

/** A process's command line; undefined when there is no such process. */
const commandLine = (pid: number) =>
  new Promise<string | undefined>((resolve) => {
    const [command, args] =
      process.platform === "win32"
        ? [
            "powershell.exe",
            [
              "-NoProfile",
              "-Command",
              `(Get-CimInstance Win32_Process -Filter "ProcessId=${String(pid)}").CommandLine`,
            ],
          ]
        : ["ps", ["-o", "command=", "-p", String(pid)]];
    execFile(command, args, (error, stdout) => {
      resolve(error ? undefined : stdout);
    });
  });

/** What a file written down before holds: nothing when there is none, or a crash cut it short. */
async function written(file: string): Promise<Written[]> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Written[];
  } catch {
    return [];
  }
}

/**
 * Writes member processes down in `file` from now on. First it stops those a
 * server before left in it: each still running whose command line names its
 * settings file, which a process that took a pid since doesn't.
 */
export async function recordMembersIn(file: string) {
  const left = await written(file);
  await Promise.all(
    left.map(async ({ pid, settings }) => {
      if (!(await commandLine(pid))?.includes(settings)) return;
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Ended meanwhile.
      }
    }),
  );
  record = file;
  save();
}

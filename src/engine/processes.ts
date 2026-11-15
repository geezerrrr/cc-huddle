/**
 * The Claude Code processes started for members (docs/design.md §3.2). One
 * MCP server runs one goal at a time, so these are this process's own: those running
 * are kept, to be stopped at once when it exits, and written down with the
 * settings file each runs under, so that a start after a server that was
 * killed outright stops what it left.
 */
import { execFile, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { errorCode } from "./core.ts";
import { writeWhole } from "./files.ts";
import { running as runs } from "./running.ts";
import { inOrder } from "./serial.ts";

/** A member process as written down: its settings file tells it from another that got its pid. */
interface Written {
  pid: number;
  settings: string;
}

/** The member processes running, by pid. */
const running = new Map<number, { child: ChildProcess; settings: string }>();

/** The file they are written down in, and where a write that fails is told (recordMembersIn). */
let record: { file: string; writes: ReturnType<typeof inOrder> } | undefined;

/** Written as they start and end, whole and one write at a time, so a file left by a crash is whole. */
function save() {
  if (!record) return;
  const { file, writes } = record;
  const written: Written[] = [...running].map(([pid, { settings }]) => ({ pid, settings }));
  writes.run(() => writeWhole(file, JSON.stringify(written)));
}

/** Keeps a member's Claude Code while it runs, with the settings file it runs under. */
export function watchMember(child: ChildProcess, settings: string) {
  const { pid } = child;
  // It didn't start: there is nothing to stop.
  if (pid === undefined) return;
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

/** What a file written down before holds: nothing when there is none. */
async function written(file: string): Promise<Written[]> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as Written[];
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
}

/** How long a member a server before left is given to exit once asked, before it is killed. */
const LEFT_EXIT_MS = 5000;

/** Whether process `pid` exits within `ms`. */
async function exits(pid: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (runs(pid)) {
    if (Date.now() > until) return false;
    await delay(50);
  }
  return true;
}

/** Stops process `pid`, settling once it has exited: asked first, killed if it won't. */
async function stopLeft(pid: number) {
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(pid, name);
    } catch {
      // Ended meanwhile.
    }
  };
  signal("SIGTERM");
  if (await exits(pid, LEFT_EXIT_MS)) return;
  signal("SIGKILL");
  await exits(pid, LEFT_EXIT_MS);
}

/**
 * Writes member processes down in `file` from now on, each write that fails
 * told to `failed`. First it stops those a server before left in it, and
 * waits until they have exited, so none still writes a session that goes on
 * here: each still running whose command line names its settings file,
 * which a process that took a pid since doesn't.
 */
export async function recordMembersIn(file: string, failed: (error: unknown) => void) {
  const left = await written(file);
  await Promise.all(
    left.map(async ({ pid, settings }) => {
      if ((await commandLine(pid))?.includes(settings)) await stopLeft(pid);
    }),
  );
  record = { file, writes: inOrder(failed) };
  save();
}

/** Stops writing members down, as the team is let go: the file is the next holder's. */
export async function stopRecording() {
  const was = record;
  record = undefined;
  // What is being written lands before the goal goes, so a deleted folder isn't made again.
  await was?.writes.idle();
}

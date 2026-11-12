import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordMembersIn, stopMembers, watchMember } from "./processes.ts";

let dir: string;
let file: string;
const started: ChildProcess[] = [];

/** A process that runs until it is stopped, with `args` on its command line. */
function lasting(...args: string[]) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "--", ...args]);
  started.push(child);
  return child;
}

const ended = (child: ChildProcess) =>
  child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, "exit");

const written = async (): Promise<unknown> => JSON.parse(await readFile(file, "utf8"));

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-processes-")));
  file = path.join(dir, "members.json");
  await recordMembersIn(file);
});

afterEach(async () => {
  for (const child of started.splice(0)) child.kill("SIGKILL");
  await rm(dir, { recursive: true, force: true });
});

describe("member processes", () => {
  it("are written down while they run, with their settings file", async () => {
    const settings = path.join(dir, "glm.json");
    const child = lasting();
    watchMember(child, ["--verbose", "--settings", settings]);
    watchMember(lasting(), ["--verbose"]);
    expect(await written()).toEqual([{ pid: child.pid, settings }]);
    child.kill();
    await ended(child);
    await vi.waitFor(async () => {
      expect(await written()).toEqual([]);
    });
  });

  it("are stopped together as the server exits", async () => {
    const children = [lasting(), lasting()];
    for (const child of children) watchMember(child, ["--settings", "x.json"]);
    stopMembers();
    await Promise.all(children.map(ended));
    expect(children.map((c) => c.signalCode)).toEqual(["SIGTERM", "SIGTERM"]);
  });

  it("left by a server killed outright are stopped, but not a process that took a pid since", async () => {
    const settings = path.join(dir, "glm.json");
    const left = lasting("--settings", settings);
    const stranger = lasting();
    await Promise.all([once(left, "spawn"), once(stranger, "spawn")]);
    await writeFile(
      file,
      JSON.stringify([
        { pid: left.pid, settings },
        { pid: stranger.pid, settings },
      ]),
    );
    await recordMembersIn(file);
    await ended(left);
    expect(left.signalCode).toBe("SIGTERM");
    expect(stranger.exitCode ?? stranger.signalCode).toBeNull();
    expect(await written()).toEqual([]);
  });
});

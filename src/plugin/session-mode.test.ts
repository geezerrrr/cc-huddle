import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { keepMode, modeOf } from "./session-mode.ts";

let dir: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "huddle-mode-")));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("a session's permission mode", () => {
  it("is kept as the hooks give it, except plan mode, which is no permission level", async () => {
    expect(modeOf(dir, process.pid)).toBeUndefined();
    await keepMode(dir, process.pid, "bypassPermissions");
    expect(modeOf(dir, process.pid)).toBe("bypassPermissions");
    await keepMode(dir, process.pid, "plan");
    expect(modeOf(dir, process.pid)).toBe("bypassPermissions");
    await keepMode(dir, process.pid, "default");
    expect(modeOf(dir, process.pid)).toBe("default");
  });

  it("is kept per session, and goes once its session has ended", async () => {
    const other = spawn(process.execPath, ["-e", ""]);
    await once(other, "exit");
    await keepMode(dir, process.pid, "auto");
    await writeFile(path.join(dir, "sessions", `${String(other.pid)}.mode`), "default");
    await keepMode(dir, process.pid, "acceptEdits");
    expect(await readdir(path.join(dir, "sessions"))).toEqual([`${String(process.pid)}.mode`]);
  });
});

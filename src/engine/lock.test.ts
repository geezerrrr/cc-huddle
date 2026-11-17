import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { holderOf, releaseLock, takeLock, type Holder } from "./lock.ts";

let dir: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "huddle-lock-")));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The session the goal is taken for, and where it is asked to let it go. */
const SESSION = 41;
const ME = { session: SESSION, address: "here" };

/** A holder that won't let the goal go. */
const refuse = (holder: Holder) => Promise.reject(new Error(`held by ${String(holder.session)}`));

describe("the lock", () => {
  it("gives the goal to one running process, and is let go of by its holder", async () => {
    const lock = path.join(dir, "repo", "lock");
    await takeLock(lock, ME, refuse);
    await takeLock(lock, ME, refuse);
    const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    await once(other, "spawn");
    await writeFile(lock, JSON.stringify({ pid: other.pid, session: 7, address: "there" }));
    releaseLock(lock);
    await expect(takeLock(lock, ME, refuse)).rejects.toThrow("held by 7");
    other.kill();
    await once(other, "exit");
    expect(holderOf(lock)).toBeUndefined();
    await takeLock(lock, ME, refuse);
    const holder = { pid: process.pid, ...ME };
    expect(holderOf(lock)).toEqual(holder);
    releaseLock(lock);
    await expect(stat(lock)).rejects.toThrow();
  });

  it("asks a running holder to let the goal go, and gives back what it stopped", async () => {
    const lock = path.join(dir, "repo", "lock");
    const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    await once(other, "spawn");
    await mkdir(path.dirname(lock), { recursive: true });
    await writeFile(lock, JSON.stringify({ pid: other.pid, session: 7, address: "there" }));
    const asked: string[] = [];
    const handed = await takeLock(lock, ME, async (holder) => {
      asked.push(holder.address);
      await rm(lock);
      return ["m1"];
    });
    other.kill();
    expect(asked).toEqual(["there"]);
    expect(handed).toEqual([["m1"]]);
    expect(holderOf(lock)).toEqual({ pid: process.pid, ...ME });
    releaseLock(lock);
  });

  it("takes a goal over from a holder whose pid another process has taken since", async () => {
    const lock = path.join(dir, "repo", "lock");
    const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    await once(other, "spawn");
    await mkdir(path.dirname(lock), { recursive: true });
    await writeFile(lock, JSON.stringify({ pid: other.pid, session: 7, address: "gone" }));
    // Nothing answers at its address.
    expect(await takeLock(lock, ME, () => Promise.resolve(undefined))).toEqual([]);
    other.kill();
    expect(holderOf(lock)).toEqual({ pid: process.pid, ...ME });
    releaseLock(lock);
  });

  it("goes to one of several sessions starting at once, also over one that has ended", async () => {
    const lock = path.join(dir, "repo", "lock");
    const take = `
      import { takeLock } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, "lock.ts")).href)};
      takeLock(process.argv[1], { session: 1, address: "" }, () => Promise.reject(new Error("held"))).then(() => console.log("took"), () => console.log("refused"));
      setTimeout(() => {}, 2000);
    `;
    const race = async () => {
      const takers = Array.from({ length: 6 }, () =>
        spawn(process.execPath, [
          "--experimental-transform-types",
          "--no-warnings",
          "--input-type=module",
          "-e",
          take,
          lock,
        ]),
      );
      const said = await Promise.all(
        takers.map(async (taker) => {
          const [line] = (await once(taker.stdout, "data")) as [Buffer];
          return line.toString().trim();
        }),
      );
      // Ended once all have tried, the taker leaves the lock behind.
      for (const taker of takers) taker.kill();
      await Promise.all(takers.map((taker) => once(taker, "exit")));
      return said.filter((word) => word === "took").length;
    };
    expect([await race(), await race()]).toEqual([1, 1]);
  });
});

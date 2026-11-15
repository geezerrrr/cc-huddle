import { describe, expect, it } from "vitest";
import { serialBy } from "./serial.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("serialBy", () => {
  it("runs tasks with the same key one after another, in order", async () => {
    const serial = serialBy();
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name} start`);
      await tick();
      log.push(`${name} end`);
    };
    await Promise.all([serial("a", task("one")), serial("a", task("two"))]);
    expect(log).toEqual(["one start", "one end", "two start", "two end"]);
  });

  it("runs tasks with different keys side by side", async () => {
    const serial = serialBy();
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name} start`);
      await tick();
      log.push(`${name} end`);
    };
    await Promise.all([serial("a", task("one")), serial("b", task("two"))]);
    expect(log.slice(0, 2)).toEqual(["one start", "two start"]);
  });

  it("goes on after a failed task", async () => {
    const serial = serialBy();
    const failed = serial("a", () => Promise.reject(new Error("no")));
    const next = serial("a", () => Promise.resolve("yes"));
    await expect(failed).rejects.toThrow("no");
    await expect(next).resolves.toBe("yes");
  });
});

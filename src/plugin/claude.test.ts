import { realpath } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { executableOf } from "./claude.ts";

describe("executableOf", () => {
  it("tells the executable a process runs", async () => {
    expect(await realpath(await executableOf(process.pid))).toBe(await realpath(process.execPath));
  });
});

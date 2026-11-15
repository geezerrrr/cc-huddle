import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pluginIds } from "./plugin-id.ts";

describe("pluginIds", () => {
  it("reads the id back from the data folder when no settings name openplan", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openplan-id-"));
    expect(await pluginIds("/x/data/openplan-my-tools", dir, dir)).toEqual(["openplan@my-tools"]);
  });

  it("adds every openplan id the user's and the project's settings name, a dotted marketplace's too", async () => {
    const config = await mkdtemp(path.join(tmpdir(), "openplan-id-"));
    const project = await mkdtemp(path.join(tmpdir(), "openplan-id-"));
    await mkdir(path.join(project, ".claude"));
    await writeFile(
      path.join(config, "settings.json"),
      JSON.stringify({ enabledPlugins: { "openplan@acme.tools": true, "other@acme.tools": true } }),
    );
    await writeFile(
      path.join(project, ".claude", "settings.local.json"),
      JSON.stringify({ enabledPlugins: { "openplan@inline": false } }),
    );
    await writeFile(path.join(project, ".claude", "settings.json"), "{ not json");
    expect(await pluginIds("/x/data/openplan-acme-tools", config, project)).toEqual([
      "openplan@acme-tools",
      "openplan@acme.tools",
      "openplan@inline",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { pluginId } from "./plugin-id.ts";

describe("pluginId", () => {
  it("reads the plugin's id back from its data folder", () => {
    expect(pluginId("/home/you/.claude/plugins/data/openplan-openplan")).toBe("openplan@openplan");
    expect(pluginId("/x/data/openplan-my-tools")).toBe("openplan@my-tools");
  });
});

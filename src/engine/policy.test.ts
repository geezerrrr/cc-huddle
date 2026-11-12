import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  expandEnv,
  memberSettings,
  pluginId,
  readOnlyOptions,
  workOptions,
  writeSettings,
} from "./policy.ts";
import type { Member } from "./types.ts";

const glm: Member = {
  name: "glm",
  role: { id: "ui-designer", title: "UI designer", duties: "" },
  model: "glm-5.3-flashx",
  effort: "max",
  env: { ANTHROPIC_BASE_URL: "https://glm.example", ANTHROPIC_AUTH_TOKEN: "${GLM_KEY}" },
};

describe("pluginId", () => {
  it("reads the plugin's id back from its data folder", () => {
    expect(pluginId("/home/you/.claude/plugins/data/openplan-openplan")).toBe("openplan@openplan");
    expect(pluginId("/x/data/openplan-my-tools")).toBe("openplan@my-tools");
  });
});

describe("expandEnv", () => {
  it("fills in variables and defaults as .mcp.json does", () => {
    expect(
      expandEnv(
        { KEY: "${GLM_KEY}", URL: "${GLM_URL:-https://default}", PLAIN: "a${B}c" },
        { GLM_KEY: "secret", B: "b" },
      ),
    ).toEqual({ KEY: "secret", URL: "https://default", PLAIN: "abc" });
  });

  it("names every variable that is unset", () => {
    expect(() => expandEnv({ A: "${ONE}", B: "${TWO}" }, {})).toThrow(
      "Not set in the environment: ONE, TWO",
    );
  });
});

describe("memberSettings", () => {
  it("lays the member's environment and the guards over the team's settings", () => {
    const settings = memberSettings(
      {
        permissions: { allow: ["Bash(pnpm test)"], deny: ["Bash(git push:*)"] },
        env: { CI: "1" },
        enabledPlugins: { "other@market": true },
      },
      glm,
      { GLM_KEY: "secret" },
      "openplan@openplan",
    );
    expect(settings).toEqual({
      permissions: {
        allow: ["Bash(pnpm test)"],
        deny: ["Bash(git push:*)", "SendMessage", "ListAgents"],
      },
      env: { CI: "1", ANTHROPIC_BASE_URL: "https://glm.example", ANTHROPIC_AUTH_TOKEN: "secret" },
      enabledPlugins: { "other@market": true, "openplan@openplan": false },
      crossSessionInbound: "refuse",
    });
  });
});

describe("writeSettings", () => {
  it("writes the settings where only you can read them, also over an older file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "openplan-policy-"));
    try {
      const file = path.join(dir, "members", "glm.json");
      await writeSettings(file, {});
      await writeFile(file, "{}", { mode: 0o644 });
      await writeSettings(file, { crossSessionInbound: "refuse" });
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ crossSessionInbound: "refuse" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("session options", () => {
  const seat = { member: glm, cwd: "/desk", settings: "/data/glm.json", system: "Your duties" };
  const from = {
    PATH: "/bin",
    CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/cc-socks/1.sock",
    CLAUDE_EFFORT: "low",
    CLAUDE_PID: "1",
  };

  it("starts a member as a session of its own, under its name", () => {
    const options = workOptions({ ...seat, session: "s1" }, from);
    expect(options).toMatchObject({
      cwd: "/desk",
      model: "glm-5.3-flashx",
      effort: "max",
      resume: "s1",
      settings: "/data/glm.json",
      systemPrompt: { type: "preset", preset: "claude_code", append: "Your duties" },
      extraArgs: { name: "openplan-glm" },
    });
    expect(options.env).toEqual({
      PATH: "/bin",
      GIT_AUTHOR_NAME: "glm",
      GIT_AUTHOR_EMAIL: "glm@openplan.local",
      GIT_COMMITTER_NAME: "glm",
      GIT_COMMITTER_EMAIL: "glm@openplan.local",
    });
  });

  it("keeps a read-only turn to the read-only tools and asks nobody", () => {
    expect(readOnlyOptions(seat, from)).toMatchObject({
      tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
      permissionMode: "dontAsk",
    });
  });
});

import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  expandEnv,
  memberSettings,
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

  it("keeps the team's own permission mode and sandbox", () => {
    const settings = memberSettings(
      { permissions: { defaultMode: "default" }, sandbox: { enabled: false } },
      glm,
      { GLM_KEY: "secret" },
      "openplan@openplan",
    );
    expect(settings).toMatchObject({
      permissions: { defaultMode: "default" },
      sandbox: { enabled: false },
    });
  });
});

describe("writeSettings", () => {
  // Windows keeps who may read a file in its ACL, not in mode bits.
  it.skipIf(process.platform === "win32")(
    "writes the settings where only you can read them, also over an older file",
    async () => {
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
    },
  );
});

describe("session options", () => {
  const seat = {
    member: glm,
    claude: "/bin/claude",
    cwd: "/desk",
    settings: "/data/glm.json",
    system: "Your duties",
  };
  const from = {
    PATH: "/bin",
    CLAUDE_CODE_MESSAGING_SOCKET: "/tmp/cc-socks/1.sock",
    CLAUDE_EFFORT: "low",
  };

  it("starts a member as a session of its own, under its name", () => {
    const options = workOptions(seat, from);
    expect(options).toMatchObject({
      cwd: "/desk",
      model: "glm-5.3-flashx",
      effort: "max",
      settings: "/data/glm.json",
      systemPrompt: { type: "preset", preset: "claude_code", append: "Your duties" },
      extraArgs: { name: "openplan-glm" },
      pathToClaudeCodeExecutable: "/bin/claude",
    });
    expect(options.env).toEqual({
      PATH: "/bin",
      GIT_AUTHOR_NAME: "glm",
      GIT_AUTHOR_EMAIL: "glm@openplan.local",
      GIT_COMMITTER_NAME: "glm",
      GIT_COMMITTER_EMAIL: "glm@openplan.local",
    });
  });

  it("works in your session's permission mode, bypassing as the SDK takes it only when that is yours", () => {
    expect(workOptions(seat, from)).not.toHaveProperty("permissionMode");
    expect(workOptions({ ...seat, mode: "acceptEdits" }, from)).toMatchObject({
      permissionMode: "acceptEdits",
    });
    expect(workOptions({ ...seat, mode: "acceptEdits" }, from)).not.toHaveProperty(
      "allowDangerouslySkipPermissions",
    );
    expect(workOptions({ ...seat, mode: "bypassPermissions" }, from)).toMatchObject({
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    });
  });

  it("keeps a read-only turn to the read-only tools and its own MCP server, and asks nobody", () => {
    expect(readOnlyOptions(seat, from)).toMatchObject({
      tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"],
      permissionMode: "dontAsk",
      strictMcpConfig: true,
    });
  });
});

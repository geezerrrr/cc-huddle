import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allowInTeam, loadTeam, teamFolder } from "./team.ts";

let top: string;

beforeEach(async () => {
  top = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-team-")));
});

afterEach(async () => {
  await rm(top, { recursive: true, force: true });
});

/** Writes files into the team folder. */
async function write(files: Record<string, string>) {
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(teamFolder(top), name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }
}

const UI = "---\ntitle: UI designer\n---\n\nDesign the screens.\n";

describe("loadTeam", () => {
  it("reads roles and members, by file name, with openplan's defaults", async () => {
    await write({
      "roles/ui-designer.md": UI,
      "roles/programmer.md": "---\ntitle: Programmer\n---\nWrite the code.",
      "members/sonnet.md": "---\nrole: programmer\nmodel: claude-sonnet-5-5\n---\n",
      "members/glm.md": [
        "---",
        "role: ui-designer",
        "model: glm-5.3-flashx",
        "effort: max",
        "env:",
        "  ANTHROPIC_AUTH_TOKEN: ${GLM_API_KEY}",
        "  API_TIMEOUT_MS: 3000000",
        "---",
        "Notes for me.",
      ].join("\n"),
    });
    const { team, settings, meetingSize } = await loadTeam(path.join(top, "user"), top);
    expect(team).toEqual({
      members: [
        {
          name: "glm",
          role: { title: "UI designer", duties: "Design the screens." },
          model: "glm-5.3-flashx",
          effort: "max",
          env: { ANTHROPIC_AUTH_TOKEN: "${GLM_API_KEY}", API_TIMEOUT_MS: "3000000" },
        },
        {
          name: "sonnet",
          role: { title: "Programmer", duties: "Write the code." },
          model: "claude-sonnet-5-5",
          env: {},
        },
      ],
      review: true,
    });
    expect([settings, meetingSize]).toEqual([{}, "discussion"]);
  });

  it("takes the team's settings and openplan's own", async () => {
    await write({
      "roles/ui-designer.md": UI,
      "members/glm.md": "---\nrole: ui-designer\n---\n",
      "settings.json": '{ "permissions": { "allow": ["Bash(pnpm test)"] } }',
      "team.json": '{ "review": false, "meetingSize": "large" }',
    });
    const { team, settings, meetingSize } = await loadTeam(path.join(top, "user"), top);
    expect([team.review, settings, meetingSize]).toEqual([
      false,
      { permissions: { allow: ["Bash(pnpm test)"] } },
      "large",
    ]);
  });

  it("takes yours under the repository's, which wins on a name both have", async () => {
    const user = path.join(top, "user");
    for (const [name, text] of Object.entries({
      "roles/ui-designer.md": UI,
      "roles/programmer.md": "---\ntitle: Programmer\n---\nWrite the code.",
      "members/glm.md": "---\nrole: ui-designer\nmodel: glm-5\n---\n",
      "members/sonnet.md": "---\nrole: programmer\n---\n",
      "settings.json": JSON.stringify({
        permissions: { allow: ["Read"], deny: ["Bash(rm:*)"] },
        model: "x",
      }),
      "team.json": '{ "review": false, "meetingSize": "large" }',
    })) {
      await mkdir(path.dirname(path.join(user, name)), { recursive: true });
      await writeFile(path.join(user, name), text);
    }
    await write({
      "roles/programmer.md": "---\ntitle: Game programmer\n---\nWrite the game.",
      "members/glm.md": "---\nrole: programmer\n---\n",
      "members/ann.md": "---\nrole: ui-designer\n---\n",
      "settings.json": JSON.stringify({ permissions: { allow: ["Read", "Bash(pnpm test)"] } }),
      "team.json": '{ "meetingSize": "small" }',
    });
    const { team, settings, meetingSize } = await loadTeam(user, top);
    expect(team.members.map((m) => [m.name, m.role.title, m.model])).toEqual([
      ["ann", "UI designer", undefined],
      ["glm", "Game programmer", undefined],
      ["sonnet", "Game programmer", undefined],
    ]);
    expect([team.review, meetingSize, settings]).toEqual([
      false,
      "small",
      {
        permissions: { allow: ["Read", "Bash(pnpm test)"], deny: ["Bash(rm:*)"] },
        model: "x",
      },
    ]);
  });

  it("says which file is wrong, and how", async () => {
    await expect(loadTeam(path.join(top, "user"), top)).rejects.toThrow("The team has no members");
    await write({ "members/glm.md": "---\nrole: ui-designer\n---\n" });
    await expect(loadTeam(path.join(top, "user"), top)).rejects.toThrow(
      /glm\.md: there is no role "ui-designer"/,
    );
    await write({
      "roles/ui-designer.md": UI,
      "members/glm.md": "---\nrole: ui-designer\neffort: huge\n---\n",
    });
    await expect(loadTeam(path.join(top, "user"), top)).rejects.toThrow(/glm\.md:\n.*effort/s);
    await write({ "members/glm.md": "---\nrole: [ui-designer\n---\n" });
    await expect(loadTeam(path.join(top, "user"), top)).rejects.toThrow(/glm\.md: /);
    await write({
      "members/glm.md": "---\nrole: ui-designer\n---\n",
      "team.json": "{ review: false }",
    });
    await expect(loadTeam(path.join(top, "user"), top)).rejects.toThrow(/team\.json: /);
  });
});

describe("allowInTeam", () => {
  it("adds allow rules once each, keeping the rest of the settings, or starts them", async () => {
    const settings = async (): Promise<unknown> =>
      JSON.parse(await readFile(path.join(teamFolder(top), "settings.json"), "utf8"));
    await allowInTeam(top, ["Bash(pnpm test)"]);
    expect(await settings()).toEqual({ permissions: { allow: ["Bash(pnpm test)"] } });
    await write({
      "settings.json": JSON.stringify({
        model: "x",
        permissions: { allow: ["Read"], deny: ["Bash(rm:*)"] },
      }),
    });
    await Promise.all([
      allowInTeam(top, ["Bash(pnpm test)", "Read"]),
      allowInTeam(top, ["WebFetch"]),
    ]);
    expect(await settings()).toEqual({
      model: "x",
      permissions: { allow: ["Read", "Bash(pnpm test)", "WebFetch"], deny: ["Bash(rm:*)"] },
    });
  });
});

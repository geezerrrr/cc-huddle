import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allowInTeam, loadTeam, shipTeam, teamFolder } from "./team.ts";

let top: string;

beforeEach(async () => {
  top = await realpath(await mkdtemp(path.join(tmpdir(), "huddle-team-")));
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
  it("reads the members from team.yaml and their roles by file name", async () => {
    await write({
      "roles/ui-designer.md": UI,
      "roles/programmer.md": "---\ntitle: Programmer\n---\nWrite the code.",
      "team.yaml": [
        "members:",
        "  sonnet:",
        "    role: programmer",
        "    model: claude-sonnet-5-5",
        "  glm:",
        "    role: ui-designer",
        "    model: glm-5.3-flashx",
        "    effort: max",
        "    env:",
        "      ANTHROPIC_AUTH_TOKEN: ${GLM_API_KEY}",
        "      API_TIMEOUT_MS: 3000000",
        "    settings:",
        "      permissions:",
        "        allow: [Write]",
      ].join("\n"),
    });
    const { team, settings } = await loadTeam(path.join(top, "user"), top);
    expect(team).toEqual({
      members: [
        {
          name: "glm",
          role: { title: "UI designer", duties: "Design the screens." },
          model: "glm-5.3-flashx",
          effort: "max",
          env: { ANTHROPIC_AUTH_TOKEN: "${GLM_API_KEY}", API_TIMEOUT_MS: "3000000" },
          settings: { permissions: { allow: ["Write"] } },
        },
        {
          name: "sonnet",
          role: { title: "Programmer", duties: "Write the code." },
          model: "claude-sonnet-5-5",
          env: {},
        },
      ],
    });
    expect(settings).toEqual({});
  });

  it("names a role by its file without a title, and by itself without a file", async () => {
    await write({
      "roles/tester.md": "Run the tests.",
      "team.yaml": "members:\n  ann:\n    role: tester\n  bob:\n    role: writer\n",
    });
    const { team } = await loadTeam(path.join(top, "user"), top);
    expect(team.members.map((m) => m.role)).toEqual([
      { title: "tester", duties: "Run the tests." },
      { title: "writer", duties: "" },
    ]);
  });

  it("takes yours under the repository's, which wins on a name both have", async () => {
    const user = path.join(top, "user");
    for (const [name, text] of Object.entries({
      "roles/ui-designer.md": UI,
      "roles/programmer.md": "---\ntitle: Programmer\n---\nWrite the code.",
      "team.yaml":
        "members:\n  glm:\n    role: ui-designer\n    model: glm-5\n  sonnet:\n    role: programmer\n",
      "settings.json": JSON.stringify({
        permissions: { allow: ["Read"], deny: ["Bash(rm:*)"] },
        model: "x",
      }),
    })) {
      await mkdir(path.dirname(path.join(user, name)), { recursive: true });
      await writeFile(path.join(user, name), text);
    }
    await write({
      "roles/programmer.md": "---\ntitle: Game programmer\n---\nWrite the game.",
      "team.yaml": "members:\n  glm:\n    role: programmer\n  ann:\n    role: ui-designer\n",
      "settings.json": JSON.stringify({ permissions: { allow: ["Read", "Bash(pnpm test)"] } }),
    });
    const { team, settings } = await loadTeam(user, top);
    expect(team.members.map((m) => [m.name, m.role.title, m.model])).toEqual([
      ["ann", "UI designer", undefined],
      ["glm", "Game programmer", undefined],
      ["sonnet", "Game programmer", undefined],
    ]);
    expect(settings).toEqual({
      permissions: { allow: ["Read", "Bash(pnpm test)"], deny: ["Bash(rm:*)"] },
      model: "x",
    });
  });

  it("takes the team's settings from yours, under the repository's, at their defaults where neither sets them", async () => {
    const user = path.join(top, "user");
    await mkdir(user, { recursive: true });
    await writeFile(path.join(user, "team.yaml"), "review: false\nmeeting: large\n");
    await write({ "team.yaml": "meeting: small\nmembers:\n  glm:\n    role: dev\n" });
    expect((await loadTeam(user, top)).goalSettings).toEqual({
      review: false,
      meetingSize: "small",
      parallel: false,
    });
  });

  it("ships its example files where they are missing, never over yours, and reads none of their comments", async () => {
    const user = path.join(top, "user");
    await mkdir(path.join(user, "roles"), { recursive: true });
    await writeFile(path.join(user, "settings.json"), "{}");
    await shipTeam(user);
    await shipTeam(user);
    expect(await readFile(path.join(user, "settings.json"), "utf8")).toBe("{}");
    await expect(loadTeam(user, top)).rejects.toThrow("The team has no members");
    await write({ "team.yaml": "members:\n  glm:\n    role: developer\n" });
    const { team, goalSettings } = await loadTeam(user, top);
    expect(team.members[0]?.role).toEqual({ title: "developer", duties: "" });
    expect(goalSettings).toEqual({ review: true, meetingSize: "discussion", parallel: false });
  });

  it("says which file is wrong, and how", async () => {
    await expect(loadTeam(path.join(top, "user"), top)).rejects.toThrow("The team has no members");
    await write({ "team.yaml": "members:\n  glm:\n    role: dev\n    effort: huge\n" });
    await expect(loadTeam(path.join(top, "user"), top)).rejects.toThrow(/team\.yaml:\n.*effort/s);
    await write({ "team.yaml": "members:\n  glm: [dev\n" });
    await expect(loadTeam(path.join(top, "user"), top)).rejects.toThrow(/team\.yaml: /);
    await write({
      "team.yaml": "members:\n  glm:\n    role: dev\n",
      "roles/dev.md": "---\ntitle: [\n---\n",
    });
    await expect(loadTeam(path.join(top, "user"), top)).rejects.toThrow(/dev\.md: /);
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

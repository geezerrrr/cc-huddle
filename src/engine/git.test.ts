import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git, GitError, openRepository } from "./git.ts";

const ME = {
  GIT_AUTHOR_NAME: "you",
  GIT_AUTHOR_EMAIL: "you@example.com",
  GIT_COMMITTER_NAME: "you",
  GIT_COMMITTER_EMAIL: "you@example.com",
};

let dir: string;
let repo: string;

/** A repository with one commit, and a hook that would fail any commit the engine made. */
async function makeRepository() {
  await git({ cwd: repo }, ["init", "-q", "--initial-branch=main"]);
  await writeFile(path.join(repo, "README.md"), "hello\n");
  await git({ cwd: repo, env: ME }, ["add", "-A"]);
  await git({ cwd: repo, env: ME }, ["commit", "-q", "-m", "start"]);
  await writeFile(path.join(repo, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", {
    mode: 0o755,
  });
}

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "openplan-git-")));
  repo = path.join(dir, "repo");
  await mkdir(repo);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("git", () => {
  it("rejects with what git said", async () => {
    await expect(git({ cwd: repo }, ["log"])).rejects.toBeInstanceOf(GitError);
  });

  it("resolves an allowed exit code", async () => {
    await makeRepository();
    const result = await git({ cwd: repo }, ["rev-parse", "--verify", "-q", "nothing"], {
      allow: [1],
    });
    expect(result.code).toBe(1);
  });

  it("never runs the repository's hooks", async () => {
    await makeRepository();
    await writeFile(path.join(repo, "a.txt"), "a\n");
    await git({ cwd: repo, env: ME }, ["add", "-A"]);
    await expect(git({ cwd: repo, env: ME }, ["commit", "-q", "-m", "a"])).resolves.toMatchObject({
      code: 0,
    });
  });
});

describe("openRepository", () => {
  it("finds the top of the repository from a folder inside it", async () => {
    await makeRepository();
    const inside = path.join(repo, "src");
    await mkdir(inside);
    expect(await openRepository(inside)).toEqual({ top: repo, common: path.join(repo, ".git") });
  });

  it("refuses a folder outside any repository", async () => {
    await expect(openRepository(repo)).rejects.toThrow("not in a git repository");
  });

  it("refuses a repository with no commit", async () => {
    await git({ cwd: repo }, ["init", "-q"]);
    await expect(openRepository(repo)).rejects.toThrow("no commit");
  });
});

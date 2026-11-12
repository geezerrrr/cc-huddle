import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  commitDesk,
  git,
  GitError,
  goalBranch,
  memberSigner,
  openDesk,
  openGoal,
  openRepository,
  slugFor,
  subtaskBranch,
  takenSlugs,
} from "./git.ts";

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

describe("goals", () => {
  const placesOf = async () => ({ repo: await openRepository(repo), root: path.join(dir, "data") });

  it("names a goal from its name, apart from the names taken", () => {
    expect(slugFor("Two-player Dice Game!", new Set())).toBe("two-player-dice-game");
    expect(slugFor("dice", new Set(["dice", "dice-2"]))).toBe("dice-3");
    expect(slugFor("骰子", new Set())).toBe("goal");
  });

  it("cuts a goal's branch from HEAD and checks it out in its own folder", async () => {
    await makeRepository();
    const places = await placesOf();
    const folder = await openGoal(places, "dice");
    const head = await git({ cwd: repo }, ["rev-parse", "HEAD"]);
    const tip = await git({ cwd: repo }, ["rev-parse", goalBranch("dice")]);
    expect(tip.stdout).toBe(head.stdout);
    const checkedOut = await git({ cwd: folder }, ["branch", "--show-current"]);
    expect(checkedOut.stdout.trim()).toBe("openplan/dice/main");
    expect(await takenSlugs(places.repo)).toEqual(new Set(["dice"]));
  });

  it("checks the goal out again when its folder was deleted by hand", async () => {
    await makeRepository();
    const places = await placesOf();
    const folder = await openGoal(places, "dice");
    await rm(folder, { recursive: true });
    await openGoal(places, "dice");
    const checkedOut = await git({ cwd: folder }, ["branch", "--show-current"]);
    expect(checkedOut.stdout.trim()).toBe("openplan/dice/main");
  });

  it("leaves your checkout where it was", async () => {
    await makeRepository();
    await openGoal(await placesOf(), "dice");
    const current = await git({ cwd: repo }, ["branch", "--show-current"]);
    expect(current.stdout.trim()).toBe("main");
  });
});

describe("desks", () => {
  const placesOf = async () => ({ repo: await openRepository(repo), root: path.join(dir, "data") });

  it("cuts a subtask's branch from the goal's and checks it out in its own folder", async () => {
    await makeRepository();
    const places = await placesOf();
    const desk = await openDesk(places, "dice", "s1");
    const checkedOut = await git({ cwd: desk }, ["branch", "--show-current"]);
    expect(checkedOut.stdout.trim()).toBe(subtaskBranch("dice", "s1"));
  });

  it("keeps a desk and what is in it while it is there", async () => {
    await makeRepository();
    const places = await placesOf();
    const desk = await openDesk(places, "dice", "s1");
    await writeFile(path.join(desk, "work.txt"), "half done\n");
    expect(await openDesk(places, "dice", "s1")).toBe(desk);
    expect(await readFile(path.join(desk, "work.txt"), "utf8")).toBe("half done\n");
  });

  it("checks a desk deleted by hand out again from its branch", async () => {
    await makeRepository();
    const places = await placesOf();
    const desk = await openDesk(places, "dice", "s1");
    await writeFile(path.join(desk, "work.txt"), "done\n");
    await git({ cwd: desk, env: ME }, ["add", "-A"]);
    await git({ cwd: desk, env: ME }, ["commit", "-q", "-m", "work"]);
    await rm(desk, { recursive: true });
    await openDesk(places, "dice", "s1");
    expect(await readFile(path.join(desk, "work.txt"), "utf8")).toBe("done\n");
  });
});

describe("commitDesk", () => {
  const placesOf = async () => ({ repo: await openRepository(repo), root: path.join(dir, "data") });
  const log = (at: string, ref: string) =>
    git({ cwd: at }, ["log", "-1", "--format=%an <%ae> %s", ref]).then((r) => r.stdout.trim());

  it("commits what the member left uncommitted, in their name", async () => {
    await makeRepository();
    const places = await placesOf();
    const desk = await openDesk(places, "dice", "s1");
    await writeFile(path.join(desk, "dice.ts"), "roll\n");
    await commitDesk(places, "dice", "s1", memberSigner("glm"), "Roll the dice");
    expect(await log(repo, subtaskBranch("dice", "s1"))).toBe(
      "glm <glm@openplan.local> Roll the dice",
    );
  });

  it("makes no commit when nothing changed", async () => {
    await makeRepository();
    const places = await placesOf();
    await openDesk(places, "dice", "s1");
    await commitDesk(places, "dice", "s1", memberSigner("glm"), "Nothing");
    expect(await log(repo, subtaskBranch("dice", "s1"))).toBe("you <you@example.com> start");
  });

  it("commits to the real worktree even when its .git file was pointed elsewhere", async () => {
    await makeRepository();
    const places = await placesOf();
    const desk = await openDesk(places, "dice", "s1");
    const other = path.join(dir, "other");
    await mkdir(other);
    await git({ cwd: other }, ["init", "-q"]);
    await writeFile(path.join(desk, ".git"), `gitdir: ${path.join(other, ".git")}\n`);
    await writeFile(path.join(desk, "dice.ts"), "roll\n");
    await commitDesk(places, "dice", "s1", memberSigner("glm"), "Roll the dice");
    expect(await log(repo, subtaskBranch("dice", "s1"))).toContain("Roll the dice");
  });
});

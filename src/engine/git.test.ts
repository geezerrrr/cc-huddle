import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  currentBranch,
  dropDesk,
  git,
  GitError,
  goalBranch,
  fastForward,
  hasWork,
  behindBase,
  mergeDesk,
  openDesk,
  openGoal,
  openRepository,
  removeGoal,
  SLUG,
  slugFor,
  subtaskBranch,
  takenSlugs,
  type Places,
} from "./git.ts";
import { goalFiles } from "../shared/layout.ts";

/** What a member commits in a subtask's worktree, as they would (here, as you). */
const committed = async (places: Places, subtaskId: string, message: string) => {
  const desk = { cwd: goalFiles(places.root).desk(subtaskId), env: ME };
  await git(desk, ["add", "-A"]);
  await git(desk, ["commit", "-q", "-m", message]);
};

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
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "huddle-git-")));
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
  const placesOf = async () => ({
    repo: await openRepository(repo),
    slug: "dice",
    root: path.join(dir, "data"),
  });

  it("names a goal from its name, apart from the names taken", () => {
    expect(slugFor("Two-player Dice Game!", new Set())).toBe("two-player-dice-game");
    expect(slugFor("dice", new Set(["dice", "dice-2"]))).toBe("dice-3");
    expect(slugFor("骰子", new Set())).toBe("goal");
    for (const name of ["Two-player Dice Game!", "--a  b--", "x".repeat(60) + " y"])
      expect(slugFor(name, new Set())).toMatch(SLUG);
    expect("../x").not.toMatch(SLUG);
  });

  it("cuts a goal's branch from HEAD and checks it out in its own folder", async () => {
    await makeRepository();
    const places = await placesOf();
    const folder = await openGoal(places);
    const head = await git({ cwd: repo }, ["rev-parse", "HEAD"]);
    const tip = await git({ cwd: repo }, ["rev-parse", goalBranch("dice")]);
    expect(tip.stdout).toBe(head.stdout);
    const checkedOut = await git({ cwd: folder }, ["branch", "--show-current"]);
    expect(checkedOut.stdout.trim()).toBe("huddle/dice/main");
    expect(await takenSlugs(places.repo)).toEqual(new Set(["dice"]));
  });

  it("carries a goal on from a closed one's branch while your HEAD lacks its work", async () => {
    await makeRepository();
    const places = await placesOf();
    const before = await git({ cwd: repo }, ["rev-parse", "HEAD"]);
    await git({ cwd: repo }, ["branch", "huddle/old/main"]);
    await openGoal(places, "huddle/old/main");
    expect((await git({ cwd: repo }, ["rev-parse", goalBranch("dice")])).stdout).toBe(
      before.stdout,
    );
    await git({ cwd: repo, env: ME }, [
      "commit-tree",
      "-m",
      "old work",
      "-p",
      "HEAD",
      "HEAD^{tree}",
    ]).then(({ stdout }) => git({ cwd: repo }, ["branch", "-f", "huddle/old/main", stdout.trim()]));
    const next = { ...places, slug: "next", root: path.join(dir, "next") };
    await openGoal(next, "huddle/old/main");
    expect((await git({ cwd: repo }, ["rev-parse", goalBranch("next")])).stdout).toBe(
      (await git({ cwd: repo }, ["rev-parse", "huddle/old/main"])).stdout,
    );
  });

  it("checks the goal out again when its folder was deleted by hand", async () => {
    await makeRepository();
    const places = await placesOf();
    const folder = await openGoal(places);
    await rm(folder, { recursive: true });
    // Two at once (a review and a meeting, say) check it out once, not twice.
    await Promise.all([openGoal(places), openGoal(places)]);
    const checkedOut = await git({ cwd: folder }, ["branch", "--show-current"]);
    expect(checkedOut.stdout.trim()).toBe("huddle/dice/main");
  });

  it("leaves your checkout where it was", async () => {
    await makeRepository();
    await openGoal(await placesOf());
    const current = await git({ cwd: repo }, ["branch", "--show-current"]);
    expect(current.stdout.trim()).toBe("main");
  });
});

describe("desks", () => {
  const placesOf = async () => ({
    repo: await openRepository(repo),
    slug: "dice",
    root: path.join(dir, "data"),
  });

  it("cuts a subtask's branch from the goal's and checks it out in its own folder", async () => {
    await makeRepository();
    const places = await placesOf();
    const desk = await openDesk(places, "s1");
    const checkedOut = await git({ cwd: desk }, ["branch", "--show-current"]);
    expect(checkedOut.stdout.trim()).toBe(subtaskBranch("dice", "s1"));
  });

  it("keeps a desk and what is in it while it is there", async () => {
    await makeRepository();
    const places = await placesOf();
    const desk = await openDesk(places, "s1");
    await writeFile(path.join(desk, "work.txt"), "half done\n");
    expect(await openDesk(places, "s1")).toBe(desk);
    expect(await readFile(path.join(desk, "work.txt"), "utf8")).toBe("half done\n");
  });

  it("checks a desk deleted by hand out again from its branch", async () => {
    await makeRepository();
    const places = await placesOf();
    const desk = await openDesk(places, "s1");
    await writeFile(path.join(desk, "work.txt"), "done\n");
    await git({ cwd: desk, env: ME }, ["add", "-A"]);
    await git({ cwd: desk, env: ME }, ["commit", "-q", "-m", "work"]);
    await rm(desk, { recursive: true });
    await openDesk(places, "s1");
    expect(await readFile(path.join(desk, "work.txt"), "utf8")).toBe("done\n");
  });
});

describe("mergeDesk", () => {
  const placesOf = async () => ({
    repo: await openRepository(repo),
    slug: "dice",
    root: path.join(dir, "data"),
  });
  const show = (ref: string, file: string) =>
    git({ cwd: repo }, ["show", `${ref}:${file}`]).then((r) => r.stdout);
  const deliver = async (places: Places, id: string, file: string, text: string) => {
    const desk = await openDesk(places, id);
    await writeFile(path.join(desk, file), text);
    await committed(places, id, `Write ${file}`);
    return desk;
  };

  it("merges a delivery into the goal and clears its worktree and branch", async () => {
    await makeRepository();
    const places = await placesOf();
    const desk = await deliver(places, "s1", "dice.ts", "roll\n");
    expect(await mergeDesk(places, "s1")).toBe("merged");
    expect(await show(goalBranch("dice"), "dice.ts")).toBe("roll\n");
    expect(await readFile(path.join(goalFiles(places.root).checkout, "dice.ts"), "utf8")).toBe(
      "roll\n",
    );
    await expect(readFile(path.join(desk, "dice.ts"))).rejects.toThrow();
    const branch = await git({ cwd: repo }, ["branch", "--list", subtaskBranch("dice", "s1")]);
    expect(branch.stdout).toBe("");
  });

  it("finds a delivery behind the goal, and merges it once its member merged the goal in", async () => {
    await makeRepository();
    const places = await placesOf();
    await deliver(places, "s1", "README.md", "one\n");
    const desk = await deliver(places, "s2", "README.md", "two\n");
    expect(await mergeDesk(places, "s1")).toBe("merged");
    expect(await mergeDesk(places, "s2")).toBe("behind");
    expect(await show(goalBranch("dice"), "README.md")).toBe("one\n");
    // The member merges as they see fit; here, by hand.
    await git({ cwd: desk }, ["merge", "-q", goalBranch("dice")], { allow: [1] });
    await writeFile(path.join(desk, "README.md"), "one and two\n");
    await committed(places, "s2", "Merge the goal");
    expect(await mergeDesk(places, "s2")).toBe("merged");
    expect(await show(goalBranch("dice"), "README.md")).toBe("one and two\n");
  });

  it("refuses to merge over changes in the goal's worktree, saying why", async () => {
    await makeRepository();
    const places = await placesOf();
    await deliver(places, "s1", "dice.ts", "roll\n");
    await writeFile(path.join(goalFiles(places.root).checkout, "dice.ts"), "tried\n");
    await expect(mergeDesk(places, "s1")).rejects.toThrow(GitError);
  });

  it("leaves your checkout as it was", async () => {
    await makeRepository();
    const places = await placesOf();
    await deliver(places, "s1", "dice.ts", "roll\n");
    await mergeDesk(places, "s1");
    const status = await git({ cwd: repo }, ["status", "--porcelain"]);
    const current = await git({ cwd: repo }, ["branch", "--show-current"]);
    expect([status.stdout, current.stdout.trim()]).toEqual(["", "main"]);
  });
});

describe("removing", () => {
  const placesOf = async () => ({
    repo: await openRepository(repo),
    slug: "dice",
    root: path.join(dir, "data"),
  });
  const branches = () =>
    git({ cwd: repo }, ["branch", "--list", "--format=%(refname:short)", "huddle/*"]).then((r) =>
      r.stdout.split("\n").filter(Boolean),
    );

  it("drops a subtask's worktree and branch so it can start over", async () => {
    await makeRepository();
    const places = await placesOf();
    const desk = await openDesk(places, "s1");
    await writeFile(path.join(desk, "half.ts"), "half\n");
    await dropDesk(places, "s1");
    expect(await branches()).toEqual(["huddle/dice/main"]);
    await openDesk(places, "s1");
    await expect(readFile(path.join(desk, "half.ts"))).rejects.toThrow();
  });

  it("removes a goal's worktrees and subtask branches and keeps its branch", async () => {
    await makeRepository();
    const places = await placesOf();
    await openDesk(places, "s1");
    await openDesk(places, "s2");
    await removeGoal(places, false);
    expect(await branches()).toEqual(["huddle/dice/main"]);
    const worktrees = await git({ cwd: repo }, ["worktree", "list", "--porcelain"]);
    expect(worktrees.stdout.match(/^worktree /gm)).toHaveLength(1);
  });
});

describe("handing a goal's work back", () => {
  const placesOf = async () => ({
    repo: await openRepository(repo),
    slug: "dice",
    root: path.join(dir, "data"),
  });
  const show = (ref: string, file: string) =>
    git({ cwd: repo }, ["show", `${ref}:${file}`]).then((r) => r.stdout);
  /** The goal's branch with a delivery of `file` merged into it. */
  const goalWith = async (file: string, text: string) => {
    const places = await placesOf();
    await openGoal(places, "main");
    const desk = await openDesk(places, "s1");
    await writeFile(path.join(desk, file), text);
    await committed(places, "s1", `Write ${file}`);
    await mergeDesk(places, "s1");
    return places;
  };
  /** A commit of yours on the branch your checkout is on. */
  const yours = async (file: string, text: string) => {
    await writeFile(path.join(repo, file), text);
    await git({ cwd: repo, env: ME }, ["add", "-A"]);
    await git({ cwd: repo, env: ME }, ["commit", "-q", "-m", `Write ${file}`]);
  };

  it("knows the branch a checkout is on, and none on a detached HEAD", async () => {
    await makeRepository();
    expect(await currentBranch(repo)).toBe("main");
    await git({ cwd: repo }, ["checkout", "-q", "--detach"]);
    expect(await currentBranch(repo)).toBeUndefined();
  });

  /** In the goal's worktree, merges `main` in as a member might, `text` the README where it conflicts. */
  const mergeIn = async (places: Places, text?: string) => {
    const checkout = goalFiles(places.root).checkout;
    await git({ cwd: checkout, env: ME }, ["merge", "-q", "--no-edit", "main"], { allow: [1] });
    if (text === undefined) return;
    await writeFile(path.join(checkout, "README.md"), text);
    await git({ cwd: checkout, env: ME }, ["commit", "-q", "-am", "Merge main"]);
  };

  it("fast-forwards the branch it was cut from, checked out in your checkout", async () => {
    await makeRepository();
    const places = await goalWith("dice.ts", "roll\n");
    expect(await hasWork(places, "main")).toBe(true);
    expect(await behindBase(places, "main")).toBe(false);
    await fastForward(places, "main");
    expect(await readFile(path.join(repo, "dice.ts"), "utf8")).toBe("roll\n");
    expect(await hasWork(places, "main")).toBe(false);
  });

  it("finds what you committed meanwhile, and moves your branch by its ref, where it isn't checked out, once it is merged in", async () => {
    await makeRepository();
    const places = await goalWith("dice.ts", "roll\n");
    await yours("notes.md", "mine\n");
    await git({ cwd: repo }, ["checkout", "-q", "-b", "elsewhere"]);
    expect(await behindBase(places, "main")).toBe(true);
    await expect(fastForward(places, "main")).rejects.toThrow(GitError);
    await mergeIn(places);
    expect(await behindBase(places, "main")).toBe(false);
    await fastForward(places, "main");
    expect(await show("main", "dice.ts")).toBe("roll\n");
    expect(await show("main", "notes.md")).toBe("mine\n");
  });

  it("fast-forwards once a member has merged your branch in, conflicts and all", async () => {
    await makeRepository();
    const places = await goalWith("README.md", "team\n");
    await yours("README.md", "mine\n");
    await mergeIn(places, "team and mine\n");
    await fastForward(places, "main");
    expect(await readFile(path.join(repo, "README.md"), "utf8")).toBe("team and mine\n");
  });

  it("refuses to fast-forward to a merge left unfinished", async () => {
    await makeRepository();
    const places = await goalWith("README.md", "team\n");
    await yours("README.md", "mine\n");
    await mergeIn(places);
    expect(await behindBase(places, "main")).toBe(true);
    await expect(fastForward(places, "main")).rejects.toThrow(GitError);
  });

  it("refuses to fast-forward over changes of yours, saying why", async () => {
    await makeRepository();
    const places = await goalWith("dice.ts", "roll\n");
    await writeFile(path.join(repo, "dice.ts"), "unsaved\n");
    await expect(fastForward(places, "main")).rejects.toThrow(GitError);
    expect(await readFile(path.join(repo, "dice.ts"), "utf8")).toBe("unsaved\n");
  });

  it("deletes a closed goal's branch with the rest of it", async () => {
    await makeRepository();
    const places = await goalWith("dice.ts", "roll\n");
    await fastForward(places, "main");
    await removeGoal(places, true);
    const left = await git({ cwd: repo }, ["branch", "--list", "huddle/*"]);
    expect(left.stdout).toBe("");
  });
});

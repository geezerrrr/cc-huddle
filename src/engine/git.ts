/**
 * Git for the team (docs/design.md §5), the only place the engine runs it.
 * It is the `git` on your PATH. The engine's own commands never run what a
 * repository's config would have them run: no hooks, no fsmonitor, no
 * signing. Members use git in their worktrees as they would anywhere.
 */
import { spawn } from "node:child_process";
import { readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { exists, ifThere, namesIfThere } from "../shared/files.ts";
import { goalFiles } from "../shared/layout.ts";
import { serialBy } from "../shared/serial.ts";

/** Every command: nothing from the repository's config runs, and paths come out as they are. */
const FLAGS = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.quotepath=false",
  "-c",
  "core.longpaths=true",
];

/** A git command that failed, named by its subcommand, with what git said. */
export class GitError extends Error {
  constructor(command: string, output: string) {
    super(`git ${command}: ${output}`);
    this.name = "GitError";
  }
}

/** Where a git command runs, and the environment it adds. */
interface At {
  cwd: string;
  env?: Record<string, string>;
}

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

interface GitOptions {
  /** Exit codes that are answers, not failures (`rev-parse --verify` answers 1). */
  allow?: number[];
}

/** Runs git and resolves with what it printed; rejects with a GitError on an exit code not allowed. */
export function git(at: At, args: string[], options: GitOptions = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", [...FLAGS, ...args], {
      cwd: at.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...at.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const exit = code ?? -1;
      if (exit === 0 || options.allow?.includes(exit)) resolve({ code: exit, stdout, stderr });
      else reject(new GitError(args[0] ?? "", (stderr || stdout).trim()));
    });
    child.stdin.end();
  });
}

/** Git's variables for a member as who a commit is by: those the engine makes for them, and their own. */
export function authorEnv(member: string): Record<string, string> {
  const email = `${member}@huddle.local`;
  return {
    GIT_AUTHOR_NAME: member,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: member,
    GIT_COMMITTER_EMAIL: email,
  };
}

/** A repository the team works on: its top folder, and the git folder its worktrees share. */
export interface Repository {
  top: string;
  common: string;
}

/**
 * The repository a folder is in. It must have a commit for a goal to start
 * from; an empty one is refused with the reason.
 */
export async function openRepository(folder: string): Promise<Repository> {
  const at = { cwd: folder };
  const found = await git(at, ["rev-parse", "--show-toplevel", "--git-common-dir"], {
    allow: [128],
  });
  const [top, common] = found.stdout.split("\n");
  if (found.code !== 0 || !top || !common)
    throw new GitError("rev-parse", `${folder} is not in a git repository`);
  if (!(await verifies(at, "HEAD")))
    throw new GitError("rev-parse", `${top} has no commit to start from yet`);
  return { top: await realpath(top), common: await realpath(path.resolve(folder, common)) };
}

/** A goal's places: its repository, its slug, and its folder in the data folder, which holds its worktree and its subtasks'. */
export interface Places {
  repo: Repository;
  slug: string;
  root: string;
}

/** Where cc-huddle's branches are: each goal's under `huddle/<slug>/`, which no other branch shares. */
const BRANCHES = "huddle/";
const goalBranches = (slug: string) => `${BRANCHES}${slug}/`;

/** The branch a goal's work is merged into. */
export const goalBranch = (slug: string) => `${goalBranches(slug)}main`;

/** The slugs goals have taken in a repository: every name with a branch under `huddle/<slug>/`. */
export async function takenSlugs(repo: Repository): Promise<Set<string>> {
  const refs = await git({ cwd: repo.top }, [
    "for-each-ref",
    "--format=%(refname:lstrip=3)",
    `refs/heads/${BRANCHES}`,
  ]);
  return new Set(refs.stdout.split("\n").flatMap((ref) => (ref ? [ref.split("/")[0] ?? ""] : [])));
}

/** What a slug is (slugFor): lowercase letters and digits in dashed runs, nothing that reaches out of a folder. */
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A goal's slug from its name: lowercase letters, digits and dashes, `-2` and on when taken. */
export function slugFor(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "goal";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const slug = `${base}-${String(n)}`;
    if (!taken.has(slug)) return slug;
  }
}

/**
 * Takes one of cc-huddle's worktrees off the repository's list, there or not.
 * Never `worktree prune`: it would also drop your own worktrees that are only
 * away, on a drive not plugged in.
 */
const unlist = (repo: Repository, folder: string) =>
  git({ cwd: repo.top }, ["worktree", "remove", "--force", folder], { allow: [128] });

/** Whether `ref` names a commit where `at` runs. */
const verifies = async (at: At, ref: string) =>
  (await git(at, ["rev-parse", "--verify", "-q", ref], { allow: [1] })).code === 0;

/** Whether the repository has a branch. */
const hasBranch = (repo: Repository, branch: string) => verifies({ cwd: repo.top }, branch);

/** Checks a branch out in a worktree at `folder`, listed afresh: a new branch from `from`, if given. */
async function checkOut(repo: Repository, folder: string, branch: string, from?: string) {
  await unlist(repo, folder);
  await git(
    { cwd: repo.top },
    from
      ? ["worktree", "add", "-q", "-b", branch, folder, from]
      : ["worktree", "add", "-q", folder, branch],
  );
}

/** The branch a subtask works on. */
export const subtaskBranch = (slug: string, subtaskId: string) =>
  `${goalBranches(slug)}${subtaskId}`;

/** One git operation per goal at a time: its branch and its worktrees are shared. */
const serial = serialBy();
const perGoal = <T>(places: Places, task: () => Promise<T>) =>
  serial(goalFiles(places.root).checkout, task);

/**
 * Sets a goal up in git, or again what of it is missing: its branch cut from
 * `from` (the branch it was cut from, §5; HEAD where it is set up again),
 * checked out in its own worktree (again, if the folder was deleted by hand).
 * Inside a goal's git operation (perGoal).
 */
async function setUpGoal(places: Places, from = "HEAD"): Promise<string> {
  const { repo, slug } = places;
  const branch = goalBranch(slug);
  const folder = goalFiles(places.root).checkout;
  if (!(await hasBranch(repo, branch))) await git({ cwd: repo.top }, ["branch", branch, from]);
  if (!(await exists(folder))) await checkOut(repo, folder, branch);
  return folder;
}

/** The goal's worktree, set up again first where it needs it (setUpGoal), as one of the goal's git operations. */
export const openGoal = (places: Places, from?: string) =>
  perGoal(places, () => setUpGoal(places, from));

/** The branch checked out in `folder`, a repository's checkout; none on a detached HEAD. */
export async function currentBranch(folder: string): Promise<string | undefined> {
  const found = await git({ cwd: folder }, ["symbolic-ref", "-q", "--short", "HEAD"], {
    allow: [1],
  });
  return found.code === 0 ? found.stdout.trim() : undefined;
}

/** Whether the goal's branch has commits `base` lacks: work to hand back. */
export function hasWork(places: Places, base: string): Promise<boolean> {
  return perGoal(places, async () => {
    const { stdout } = await git({ cwd: places.repo.top }, [
      "rev-list",
      "--count",
      `refs/heads/${base}..${goalBranch(places.slug)}`,
    ]);
    return Number(stdout.trim()) > 0;
  });
}

/**
 * A subtask's worktree: its own if there (a run going on keeps it), its
 * branch checked out again if only that is (the folder deleted by hand), else
 * a new branch cut from the goal's branch as it stands now.
 */
export function openDesk(places: Places, subtaskId: string): Promise<string> {
  return perGoal(places, async () => {
    const { repo, slug } = places;
    const desk = goalFiles(places.root).desk(subtaskId);
    await setUpGoal(places);
    if (await exists(path.join(desk, ".git"))) return desk;
    await rm(desk, { recursive: true, force: true });
    const branch = subtaskBranch(slug, subtaskId);
    await checkOut(
      repo,
      desk,
      branch,
      (await hasBranch(repo, branch)) ? undefined : goalBranch(slug),
    );
    return desk;
  });
}

/**
 * How git runs in one of cc-huddle's worktrees: pinned to its entry in the
 * repository's own `worktrees/` (the one whose `gitdir` names this folder),
 * never found through the `.git` file in the tree. A member can rewrite that
 * file; pointed at a repository of its own making, the engine would run what
 * that one's config says (core.fsmonitor, filters). A worktree whose entry
 * lost track of it is repaired from the repository's side first.
 */
async function worktreeAt(repo: Repository, tree: string): Promise<At> {
  const real = (file: string) => ifThere(realpath(file), path.resolve(file));
  const here = await real(tree);
  const entries = path.join(repo.common, "worktrees");
  const find = async () => {
    for (const name of await namesIfThere(entries)) {
      const gitdir = await ifThere(readFile(path.join(entries, name, "gitdir"), "utf8"), "");
      if (gitdir && (await real(path.dirname(gitdir.trim()))) === here)
        return path.join(entries, name);
    }
  };
  const entry =
    (await find()) ??
    (await git({ cwd: repo.top }, ["worktree", "repair", tree], { allow: [128] }).then(find));
  if (!entry) throw new GitError("worktree", `${tree} isn't a worktree of ${repo.top}`);
  return { cwd: tree, env: { GIT_DIR: entry, GIT_WORK_TREE: tree } };
}

/** Whether a worktree is in the middle of a merge. */
const merging = (at: At) => verifies(at, "MERGE_HEAD");

/**
 * Commits what a subtask's worktree holds and its member left uncommitted, in
 * the name of whoever delivered it, finishing a merge it was in: a delivery
 * is the worktree as it stands.
 */
export function commitDesk(
  places: Places,
  subtaskId: string,
  by: string,
  message: string,
): Promise<void> {
  return perGoal(places, async () => {
    const at = await worktreeAt(places.repo, goalFiles(places.root).desk(subtaskId));
    const signed = { ...at, env: { ...at.env, ...authorEnv(by) } };
    await git(signed, ["add", "-A"]);
    const staged = await git(signed, ["diff", "--cached", "--quiet"], { allow: [1] });
    if (staged.code === 1 || (await merging(signed)))
      await git(signed, ["commit", "-q", "--allow-empty", "-m", message]);
  });
}

/** Takes a subtask's worktree and its branch away. */
async function removeDesk(places: Places, subtaskId: string) {
  const desk = goalFiles(places.root).desk(subtaskId);
  await unlist(places.repo, desk);
  await rm(desk, { recursive: true, force: true });
  await git(
    { cwd: places.repo.top },
    ["branch", "-q", "-D", subtaskBranch(places.slug, subtaskId)],
    {
      allow: [1],
    },
  );
}

/** Whether `ancestor` is in the history of `commit` (both as git names them). */
async function contains(at: At, commit: string, ancestor: string): Promise<boolean> {
  const found = await git(at, ["merge-base", "--is-ancestor", ancestor, commit], { allow: [1] });
  return found.code === 0;
}

/**
 * Merges a delivered subtask into its goal (§5): the goal's branch
 * fast-forwards to the subtask's, and its worktree goes with its branch.
 * `behind` where the goal's branch has commits the subtask's lacks, for its
 * member to merge in; what else git refuses throws, saying why. Safe to run
 * again: a subtask merged already is gone with its branch.
 */
export function mergeDesk(places: Places, subtaskId: string): Promise<"merged" | "behind"> {
  return perGoal(places, async () => {
    const { repo, slug } = places;
    const branch = subtaskBranch(slug, subtaskId);
    if (!(await hasBranch(repo, branch))) return "merged";
    const goal = await worktreeAt(repo, await setUpGoal(places));
    const head = (await git(goal, ["rev-parse", `refs/heads/${branch}`])).stdout.trim();
    if (!(await contains(goal, head, "HEAD"))) return "behind";
    await git(goal, ["merge", "-q", "--ff-only", head]);
    await removeDesk(places, subtaskId);
    return "merged";
  });
}

/** Throws a subtask's worktree away with its branch: it starts over. */
export function dropDesk(places: Places, subtaskId: string): Promise<void> {
  return perGoal(places, () => removeDesk(places, subtaskId));
}

/** Whether `base` has commits the goal's branch lacks, to merge in before handing the work back (§5). */
export function behindBase(places: Places, base: string): Promise<boolean> {
  return perGoal(places, async () => {
    const goal = await worktreeAt(places.repo, await setUpGoal(places));
    return !(await contains(goal, "HEAD", `refs/heads/${base}`));
  });
}

/**
 * Fast-forwards `base` to the goal's branch, handing the goal's work back
 * (§5): in the worktree that has it checked out, or by its ref
 * where none has. What git refuses throws, saying why: changes of yours in
 * the way, or `base` having commits the goal's branch lacks (it moved
 * meanwhile, or the merge into the goal's branch wasn't finished).
 */
export function fastForward(places: Places, base: string): Promise<void> {
  return perGoal(places, async () => {
    const { repo } = places;
    const ref = `refs/heads/${base}`;
    const at = await worktreeAt(repo, await setUpGoal(places));
    const head = (await git(at, ["rev-parse", "HEAD"])).stdout.trim();
    const checkout = await checkedOut(repo, ref);
    if (checkout) {
      await git({ cwd: checkout }, ["merge", "-q", "--ff-only", head]);
      return;
    }
    const was = (await git({ cwd: repo.top }, ["rev-parse", ref])).stdout.trim();
    if (!(await contains({ cwd: repo.top }, head, was)))
      throw new GitError("merge", `${base} has commits the goal's branch lacks: merge again`);
    await git({ cwd: repo.top }, ["update-ref", ref, head, was]);
  });
}

/** The worktree that has `ref` checked out, if one has. */
async function checkedOut(repo: Repository, ref: string): Promise<string | undefined> {
  const list = await git({ cwd: repo.top }, ["worktree", "list", "--porcelain", "-z"]);
  let tree: string | undefined;
  for (const line of list.stdout.split("\0")) {
    if (line.startsWith("worktree ")) tree = line.slice("worktree ".length);
    else if (line === `branch ${ref}`) return tree;
  }
  return undefined;
}

/**
 * Takes a deleted goal out of the repository: its subtasks' worktrees and
 * branches and its own worktree. Its branch stays, yours to merge or delete,
 * unless `branchToo`: a closed goal's is in the branch it was cut from.
 */
export function removeGoal(places: Places, branchToo: boolean): Promise<void> {
  return perGoal(places, async () => {
    const { repo, slug } = places;
    const refs = await git({ cwd: repo.top }, [
      "for-each-ref",
      "--format=%(refname:lstrip=4)",
      `refs/heads/${goalBranches(slug)}`,
    ]);
    for (const id of refs.stdout.split("\n")) {
      if (id && id !== "main") await removeDesk(places, id);
    }
    const folder = goalFiles(places.root).checkout;
    await unlist(repo, folder);
    await rm(folder, { recursive: true, force: true });
    if (branchToo)
      await git({ cwd: repo.top }, ["branch", "-q", "-D", goalBranch(slug)], { allow: [1] });
  });
}

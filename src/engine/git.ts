/**
 * Git for the team (docs/design.md §5), the only place the engine runs it.
 * It is the `git` on your PATH. The engine's own commands never run what a
 * repository's config would have them run: no hooks, no fsmonitor, no
 * signing. Members use git in their worktrees as they would anywhere.
 */
import { spawn } from "node:child_process";
import { readdir, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { serialBy } from "./serial.ts";

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

/** A git command that failed: its arguments and what git said. */
export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly code: number,
    readonly output: string,
  ) {
    super(`git ${args[0] ?? ""}: ${output}`);
    this.name = "GitError";
  }
}

/** Where a git command runs, and the environment it adds. */
export interface At {
  cwd: string;
  env?: Record<string, string>;
}

export interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitOptions {
  /** Exit codes that are answers, not failures (`rev-parse --verify` answers 1). */
  allow?: number[];
  /** What the command reads on stdin. */
  input?: string;
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
      else reject(new GitError(args, exit, (stderr || stdout).trim()));
    });
    child.stdin.end(options.input);
  });
}

/** Who a commit is by. */
export interface Signer {
  name: string;
  email: string;
}

/** A member as the author of their commits. */
export const memberSigner = (member: string): Signer => ({
  name: member,
  email: `${member}@openplan.local`,
});

/** Git's variables for who a commit is by: the engine's commits, and those members make themselves. */
export const authorEnv = (by: Signer): Record<string, string> => ({
  GIT_AUTHOR_NAME: by.name,
  GIT_AUTHOR_EMAIL: by.email,
  GIT_COMMITTER_NAME: by.name,
  GIT_COMMITTER_EMAIL: by.email,
});

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
    throw new GitError(["rev-parse"], found.code, `${folder} is not in a git repository`);
  const head = await git(at, ["rev-parse", "--verify", "-q", "HEAD"], { allow: [1] });
  if (head.code !== 0)
    throw new GitError(["rev-parse"], head.code, `${top} has no commit to start from yet`);
  return { top: await realpath(top), common: await realpath(path.resolve(folder, common)) };
}

/** A repository and the folder in the data folder that holds its goals' and subtasks' worktrees. */
export interface Places {
  repo: Repository;
  root: string;
}

/** The branch a goal's work is merged into. */
export const goalBranch = (slug: string) => `openplan/${slug}/main`;

/** The worktree a goal's branch is checked out in. */
export const goalFolder = (places: Places, slug: string) => path.join(places.root, "goals", slug);

/** The slugs goals have taken in a repository: every name with a branch under `openplan/<slug>/`. */
export async function takenSlugs(repo: Repository): Promise<Set<string>> {
  const refs = await git({ cwd: repo.top }, [
    "for-each-ref",
    "--format=%(refname:lstrip=3)",
    "refs/heads/openplan/",
  ]);
  return new Set(refs.stdout.split("\n").flatMap((ref) => (ref ? [ref.split("/")[0] ?? ""] : [])));
}

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

const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );

/**
 * Takes one of openplan's worktrees off the repository's list, there or not.
 * Never `worktree prune`: it would also drop your own worktrees that are only
 * away, on a drive not plugged in.
 */
const unlist = (repo: Repository, folder: string) =>
  git({ cwd: repo.top }, ["worktree", "remove", "--force", folder], { allow: [128] });

/** Whether the repository has a branch. */
async function hasBranch(repo: Repository, branch: string): Promise<boolean> {
  const found = await git({ cwd: repo.top }, ["rev-parse", "--verify", "-q", branch], {
    allow: [1],
  });
  return found.code === 0;
}

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

/**
 * Sets a goal up in git, or again what of it is missing: its branch cut from
 * your HEAD, checked out in its own worktree (again, if the folder was
 * deleted by hand).
 */
export async function openGoal(places: Places, slug: string): Promise<string> {
  const { repo } = places;
  const branch = goalBranch(slug);
  const folder = goalFolder(places, slug);
  if (!(await hasBranch(repo, branch))) await git({ cwd: repo.top }, ["branch", branch, "HEAD"]);
  if (!(await exists(folder))) await checkOut(repo, folder, branch);
  return folder;
}

/** The branch a subtask works on. */
export const subtaskBranch = (slug: string, subtaskId: string) => `openplan/${slug}/${subtaskId}`;

/** The worktree a subtask works in. */
export const deskFolder = (places: Places, subtaskId: string) =>
  path.join(places.root, "desks", subtaskId);

/** One git operation per goal at a time: its branch and its worktrees are shared. */
const serial = serialBy();
const perGoal = <T>(places: Places, slug: string, task: () => Promise<T>) =>
  serial(goalFolder(places, slug), task);

/**
 * A subtask's worktree: its own if there (a run going on keeps it), its
 * branch checked out again if only that is (the folder deleted by hand), else
 * a new branch cut from the goal's branch as it stands now.
 */
export function openDesk(places: Places, slug: string, subtaskId: string): Promise<string> {
  return perGoal(places, slug, async () => {
    const { repo } = places;
    const desk = deskFolder(places, subtaskId);
    await openGoal(places, slug);
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
 * How git runs in one of openplan's worktrees: pinned to its entry in the
 * repository's own `worktrees/` (the one whose `gitdir` names this folder),
 * never found through the `.git` file in the tree. A member can rewrite that
 * file; pointed at a repository of its own making, the engine would run what
 * that one's config says (core.fsmonitor, filters). A worktree whose entry
 * lost track of it is repaired from the repository's side first.
 */
async function worktreeAt(repo: Repository, tree: string): Promise<At> {
  const real = (file: string) => realpath(file).catch(() => path.resolve(file));
  const here = await real(tree);
  const entries = path.join(repo.common, "worktrees");
  const find = async () => {
    for (const name of await readdir(entries).catch(() => [] as string[])) {
      const gitdir = await readFile(path.join(entries, name, "gitdir"), "utf8").catch(() => "");
      if (gitdir && (await real(path.dirname(gitdir.trim()))) === here)
        return path.join(entries, name);
    }
  };
  const entry =
    (await find()) ??
    (await git({ cwd: repo.top }, ["worktree", "repair", tree], { allow: [128] }).then(find));
  if (!entry) throw new GitError(["worktree"], 128, `${tree} isn't a worktree of ${repo.top}`);
  return { cwd: tree, env: { GIT_DIR: entry, GIT_WORK_TREE: tree } };
}

/** Whether a worktree is in the middle of a merge. */
const merging = async (at: At) =>
  (await git(at, ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { allow: [1] })).code === 0;

/**
 * Commits what a subtask's worktree holds and its member left uncommitted, in
 * the name of whoever delivered it, finishing a merge it was in: a delivery
 * is the worktree as it stands.
 */
export function commitDesk(
  places: Places,
  slug: string,
  subtaskId: string,
  by: Signer,
  message: string,
): Promise<void> {
  return perGoal(places, slug, async () => {
    const at = await worktreeAt(places.repo, deskFolder(places, subtaskId));
    const signed = { ...at, env: { ...at.env, ...authorEnv(by) } };
    await git(signed, ["add", "-A"]);
    const staged = await git(signed, ["diff", "--cached", "--quiet"], { allow: [1] });
    if (staged.code === 1 || (await merging(signed)))
      await git(signed, ["commit", "-q", "--allow-empty", "-m", message]);
  });
}

/** What merging a delivery came to: merged into the goal, or conflicts (text ones for the member, the rest for you). */
export type MergeOutcome =
  { kind: "merged" } | { kind: "conflict"; text: string[]; other: string[] };

/** A conflict git wrote into a text file (its lines may end in \r\n). */
const MARKERS = /^<{7} [\s\S]*?^={7}\r?$[\s\S]*?^>{7} /m;

/** Of the files a merge left in conflict in a subtask's worktree, those still holding conflict markers. */
export async function unresolved(
  places: Places,
  subtaskId: string,
  files: string[],
): Promise<string[]> {
  const desk = deskFolder(places, subtaskId);
  const marked = await Promise.all(
    files.map((file) =>
      readFile(path.join(desk, file), "utf8").then(
        (text) => MARKERS.test(text),
        () => false,
      ),
    ),
  );
  return files.filter((_, i) => marked[i]);
}

/**
 * The conflicts a subtask's worktree has, if any: text ones (markers in them)
 * apart from the rest (binary, deleted on one side).
 */
async function conflicts(
  places: Places,
  subtaskId: string,
  at: At,
): Promise<Extract<MergeOutcome, { kind: "conflict" }> | undefined> {
  const list = await git(at, ["diff", "--name-only", "-z", "--diff-filter=U"]);
  const files = list.stdout.split("\0").filter(Boolean);
  if (!files.length) return undefined;
  const text = await unresolved(places, subtaskId, files);
  return { kind: "conflict", text, other: files.filter((file) => !text.includes(file)) };
}

/** Takes a subtask's worktree and its branch away. */
async function removeDesk(places: Places, slug: string, subtaskId: string) {
  const desk = deskFolder(places, subtaskId);
  await unlist(places.repo, desk);
  await rm(desk, { recursive: true, force: true });
  await git({ cwd: places.repo.top }, ["branch", "-q", "-D", subtaskBranch(slug, subtaskId)], {
    allow: [1],
  });
}

/**
 * Merges a delivered subtask into its goal: the goal's branch is merged into
 * the subtask's worktree, and when that is clean the goal's branch moves up
 * to it and the worktree goes with its branch. Conflicts stay in the
 * worktree, the merge half done. Safe to run again: a subtask merged already
 * is gone with its branch.
 */
export function mergeDesk(
  places: Places,
  slug: string,
  subtaskId: string,
  by: Signer,
): Promise<MergeOutcome> {
  return perGoal(places, slug, async () => {
    const { repo } = places;
    const folder = deskFolder(places, subtaskId);
    if (!(await exists(folder))) {
      const branch = subtaskBranch(slug, subtaskId);
      if (!(await hasBranch(repo, branch))) return { kind: "merged" };
      await checkOut(repo, folder, branch);
    }
    const at = await worktreeAt(repo, folder);
    const desk = { ...at, env: { ...at.env, ...authorEnv(by) } };
    if (await merging(desk)) {
      const found = await conflicts(places, subtaskId, desk);
      if (found) return found;
      await git(desk, ["commit", "-q", "--no-edit"]);
    } else {
      // As git does by default, whatever your own setup says (merge.ff=only would refuse it).
      const merge = await git(
        desk,
        ["-c", "merge.ff=true", "merge", "-q", "--no-edit", goalBranch(slug)],
        { allow: [1] },
      );
      if (merge.code === 1) {
        const found = await conflicts(places, subtaskId, desk);
        if (found) return found;
        throw new GitError(["merge"], 1, (merge.stderr || merge.stdout).trim());
      }
    }
    const head = (await git(desk, ["rev-parse", "HEAD"])).stdout.trim();
    const goal = await worktreeAt(repo, await openGoal(places, slug));
    await git(goal, ["merge", "-q", "--ff-only", head]);
    await removeDesk(places, slug, subtaskId);
    return { kind: "merged" };
  });
}

/** A file's path as a pathspec that means only that file (`[id]`, `*` in a name aren't patterns). */
const literally = (file: string) => `:(literal)${file}`;

/**
 * Your pick for conflicts that can't be merged line by line: the subtask's
 * version or the goal's, for each file (a file deleted on that side goes).
 * Text conflicts stay for the member.
 */
export function pickSide(
  places: Places,
  slug: string,
  subtaskId: string,
  files: string[],
  side: "ours" | "theirs",
): Promise<void> {
  return perGoal(places, slug, async () => {
    const desk = await worktreeAt(places.repo, deskFolder(places, subtaskId));
    const stages = await git(desk, ["ls-files", "-u", "-z", "--", ...files.map(literally)]);
    const wanted = side === "ours" ? "2" : "3";
    const kept = new Set(
      stages.stdout
        .split("\0")
        .filter(Boolean)
        .map((line) => line.split("\t"))
        .filter(([meta]) => meta?.split(" ")[2] === wanted)
        .map(([, file]) => file),
    );
    for (const file of files) {
      if (kept.has(file)) {
        await git(desk, ["checkout", `--${side}`, "--", literally(file)]);
        await git(desk, ["add", "--", literally(file)]);
      } else await git(desk, ["rm", "-q", "--", literally(file)]);
    }
  });
}

/** Calls off a merge a subtask's worktree is in the middle of, to try it again from scratch. */
export function abortMerge(places: Places, slug: string, subtaskId: string): Promise<void> {
  return perGoal(places, slug, async () => {
    const desk = await worktreeAt(places.repo, deskFolder(places, subtaskId));
    if (await merging(desk)) await git(desk, ["merge", "--abort"]);
  });
}

/** Throws a subtask's worktree away with its branch: it starts over, or its goal is deleted. */
export function dropDesk(places: Places, slug: string, subtaskId: string): Promise<void> {
  return perGoal(places, slug, () => removeDesk(places, slug, subtaskId));
}

/**
 * Takes a deleted goal out of the repository: its subtasks' worktrees and
 * branches and its own worktree. Its branch stays, yours to merge or delete.
 */
export function removeGoal(places: Places, slug: string): Promise<void> {
  return perGoal(places, slug, async () => {
    const { repo } = places;
    const refs = await git({ cwd: repo.top }, [
      "for-each-ref",
      "--format=%(refname:lstrip=4)",
      `refs/heads/openplan/${slug}/`,
    ]);
    for (const id of refs.stdout.split("\n")) {
      if (id && id !== "main") await removeDesk(places, slug, id);
    }
    const folder = goalFolder(places, slug);
    await unlist(repo, folder);
    await rm(folder, { recursive: true, force: true });
  });
}

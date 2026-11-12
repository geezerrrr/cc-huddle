/**
 * Git for the team (docs/design.md §5), the only place the engine runs it.
 * It is the `git` on your PATH. The engine's own commands never run what a
 * repository's config would have them run: no hooks, no fsmonitor, no
 * signing. Members use git in their worktrees as they would anywhere.
 */
import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";

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

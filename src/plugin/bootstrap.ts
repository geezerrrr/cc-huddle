/**
 * How the installed plugin starts its MCP server. The Agent SDK isn't ours to
 * ship, so the server's dependencies are installed from npm into the data
 * folder the first time a version runs, exactly as `dist/package-lock.json`
 * locks them, and the server's imports are resolved from there. Not the SDK's
 * own Claude Code: members run your session's (claude.ts).
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
// Whole, so an older Node.js gets to say what it lacks.
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { exists, renameOver } from "../shared/files.ts";
import { running } from "../shared/running.ts";
import { dataFolder } from "./data-folder.ts";
import { depsFolder } from "../shared/layout.ts";

if (!("registerHooks" in nodeModule))
  throw new Error(`openplan needs Node.js 22.15 or later; this is ${process.version}`);
const { registerHooks } = nodeModule;

/** How long the first start may take to install the dependencies. */
const INSTALL_TIMEOUT_MS = 5 * 60_000;

const here = path.dirname(fileURLToPath(import.meta.url));
/** What names the dependencies, and what locks them: each file and its text. */
const manifests = await Promise.all(
  ["package.json", "package-lock.json"].map(
    async (file) => [file, await readFile(path.join(here, file), "utf8")] as const,
  ),
);
const deps = depsFolder(dataFolder);
/** The dependencies of this version, by what it locks. */
const home = path.join(
  deps,
  manifests
    .reduce((hash, [, text]) => hash.update(text), createHash("sha256"))
    .digest("hex")
    .slice(0, 12),
);

const installed = () => exists(path.join(home, "node_modules"));

if (!(await installed())) {
  // Installed beside, then moved in whole: two sessions starting at once don't share a half install.
  const draft = `${home}.${String(process.pid)}`;
  await mkdir(draft, { recursive: true });
  for (const [file, text] of manifests) await writeFile(path.join(draft, file), text);
  try {
    await promisify(execFile)(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["ci", "--omit=optional", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: draft, shell: process.platform === "win32", timeout: INSTALL_TIMEOUT_MS },
    );
    await renameOver(draft, home);
  } catch (error) {
    await rm(draft, { recursive: true, force: true });
    // Another session's install got there first.
    if (!(await installed()))
      throw new Error(`openplan couldn't install its dependencies with npm in ${draft}`, {
        cause: error,
      });
  }
  // What earlier versions installed goes, and installs left half done by a process that ended.
  for (const name of await readdir(deps)) {
    const [, pid] = name.split(".");
    if (path.join(deps, name) !== home && !(pid && running(Number(pid))))
      await rm(path.join(deps, name), { recursive: true, force: true });
  }
}

const ours = pathToFileURL(here).href;
const from = pathToFileURL(path.join(home, "package.json")).href;
registerHooks({
  resolve(specifier, context, next) {
    const bare = !/^(\.|\/|node:|file:|data:)/.test(specifier);
    return bare && context.parentURL?.startsWith(ours)
      ? next(specifier, { ...context, parentURL: from })
      : next(specifier, context);
  },
});

await import("./server.ts");

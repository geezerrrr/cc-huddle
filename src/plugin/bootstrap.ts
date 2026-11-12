/**
 * How the installed plugin starts its MCP server. The Agent SDK isn't ours to
 * ship, so the server's dependencies are installed from npm into the data
 * folder (`dist/package.json` names them) the first time a version runs, and
 * the server's imports are resolved from there. Not the SDK's own Claude
 * Code: members run your session's (claude.ts).
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { running } from "../engine/running.ts";

const dataFolder = process.env.CLAUDE_PLUGIN_DATA;
if (!dataFolder)
  throw new Error("openplan's MCP server runs in Claude Code, which gives it CLAUDE_PLUGIN_DATA");

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = await readFile(path.join(here, "package.json"), "utf8");
const deps = path.join(dataFolder, "deps");
/** The dependencies of this version, by what it names. */
const home = path.join(deps, createHash("sha256").update(manifest).digest("hex").slice(0, 12));

const exists = (file: string) =>
  stat(file).then(
    () => true,
    () => false,
  );

if (!(await exists(path.join(home, "node_modules")))) {
  // Installed beside, then moved in whole: two sessions starting at once don't share a half install.
  const draft = `${home}.${String(process.pid)}`;
  await mkdir(draft, { recursive: true });
  await writeFile(path.join(draft, "package.json"), manifest);
  try {
    await promisify(execFile)(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["install", "--omit=optional", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: draft, shell: process.platform === "win32" },
    );
  } catch (error) {
    await rm(draft, { recursive: true, force: true });
    throw new Error(`openplan couldn't install its dependencies with npm in ${draft}`, {
      cause: error,
    });
  }
  try {
    await rename(draft, home);
  } catch {
    // Another session's install got there first.
    await rm(draft, { recursive: true, force: true });
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

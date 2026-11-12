import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// src/plugin/bootstrap.ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
var dataFolder = process.env.CLAUDE_PLUGIN_DATA;
if (!dataFolder)
  throw new Error("openplan's MCP server runs in Claude Code, which gives it CLAUDE_PLUGIN_DATA");
var here = path.dirname(fileURLToPath(import.meta.url));
var manifest = await readFile(path.join(here, "package.json"), "utf8");
var deps = path.join(dataFolder, "deps");
var home = path.join(deps, createHash("sha256").update(manifest).digest("hex").slice(0, 12));
var exists = (file) => stat(file).then(
  () => true,
  () => false
);
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
if (!await exists(path.join(home, "node_modules"))) {
  const draft = `${home}.${String(process.pid)}`;
  await mkdir(draft, { recursive: true });
  await writeFile(path.join(draft, "package.json"), manifest);
  try {
    await promisify(execFile)(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["install", "--omit=optional", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: draft, shell: process.platform === "win32" }
    );
  } catch (error) {
    await rm(draft, { recursive: true, force: true });
    throw new Error(`openplan couldn't install its dependencies with npm in ${draft}`, {
      cause: error
    });
  }
  try {
    await rename(draft, home);
  } catch {
    await rm(draft, { recursive: true, force: true });
  }
  for (const name of await readdir(deps)) {
    const [, pid] = name.split(".");
    if (path.join(deps, name) !== home && !(pid && running(Number(pid))))
      await rm(path.join(deps, name), { recursive: true, force: true });
  }
}
var ours = pathToFileURL(here).href;
var from = pathToFileURL(path.join(home, "package.json")).href;
registerHooks({
  resolve(specifier, context, next) {
    const bare = !/^(\.|\/|node:|file:|data:)/.test(specifier);
    return bare && context.parentURL?.startsWith(ours) ? next(specifier, { ...context, parentURL: from }) : next(specifier, context);
  }
});
await import("./chunks/server-RKT72UTF.mjs");

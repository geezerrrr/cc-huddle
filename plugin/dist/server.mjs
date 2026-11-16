import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
import {
  dataFolder,
  depsFolders,
  exists,
  renameOver,
  running
} from "./chunks/chunk-L4DDGNIV.mjs";

// src/plugin/bootstrap.ts
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import * as nodeModule from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
if (!("registerHooks" in nodeModule))
  throw new Error(`openplan needs Node.js 22.15 or later; this is ${process.version}`);
var { registerHooks } = nodeModule;
var INSTALL_TIMEOUT_MS = 5 * 6e4;
var here = path.dirname(fileURLToPath(import.meta.url));
var manifests = await Promise.all(
  ["package.json", "package-lock.json"].map(
    async (file) => [file, await readFile(path.join(here, file), "utf8")]
  )
);
var deps = depsFolders(dataFolder);
var home = deps.version(
  manifests.reduce((hash, [, text]) => hash.update(text), createHash("sha256")).digest("hex")
);
var installed = () => exists(path.join(home, "node_modules"));
if (!await installed()) {
  const draft = deps.draft(home, process.pid);
  await mkdir(draft, { recursive: true });
  for (const [file, text] of manifests) await writeFile(path.join(draft, file), text);
  try {
    await promisify(execFile)(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["ci", "--omit=optional", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
      { cwd: draft, shell: process.platform === "win32", timeout: INSTALL_TIMEOUT_MS }
    );
    await renameOver(draft, home);
  } catch (error) {
    await rm(draft, { recursive: true, force: true });
    if (!await installed())
      throw new Error(`openplan couldn't install its dependencies with npm in ${draft}`, {
        cause: error
      });
  }
  for (const name of await readdir(deps.folder)) {
    const pid = deps.pidOf(name);
    if (path.join(deps.folder, name) !== home && !(pid !== void 0 && running(pid)))
      await rm(path.join(deps.folder, name), { recursive: true, force: true });
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
await import("./chunks/server-4PF4WLKM.mjs");

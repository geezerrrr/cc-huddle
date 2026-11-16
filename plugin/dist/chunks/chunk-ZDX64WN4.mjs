import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/shared/errors.ts
var errorText = (error) => error instanceof Error ? error.message : String(error);
var errorCode = (error) => error.code;

// src/shared/files.ts
import { readFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
async function ifThere(reading, missing) {
  try {
    return await reading;
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return missing;
    throw error;
  }
}
var exists = (file) => ifThere(
  stat(file).then(() => true),
  false
);
function textIfThere(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return void 0;
    throw error;
  }
}
async function jsonIfThere(file) {
  const text = await ifThere(readFile(file, "utf8"), void 0);
  if (text === void 0) return void 0;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SyntaxError(`${file}: ${error.message}`, { cause: error });
  }
}
var namesIfThere = (folder2) => ifThere(readdir(folder2), []);
var HELD = /* @__PURE__ */ new Set(["EPERM", "EACCES", "EBUSY"]);
var HELD_WAIT_MS = 5e3;
async function renameOver(from, to) {
  const until = Date.now() + HELD_WAIT_MS;
  for (let wait = 10; ; wait = Math.min(wait * 2, 500)) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const held = process.platform === "win32" && HELD.has(errorCode(error) ?? "");
      if (!held || Date.now() > until) throw error;
      await delay(wait);
    }
  }
}
var writes = 0;
var fresh = (file) => `${file}.${String(process.pid)}.${String(writes += 1)}.new`;
async function writeWhole(file, text, mode) {
  await mkdir(path.dirname(file), { recursive: true });
  const beside = fresh(file);
  await writeFile(beside, text, { mode });
  await renameOver(beside, file);
}

// src/shared/running.ts
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === "ESRCH") return false;
    if (errorCode(error) === "EPERM") return true;
    throw error;
  }
}
var windowsProcessField = (pid, field) => [
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    `(Get-CimInstance Win32_Process -Filter "ProcessId=${String(pid)}").${field}`
  ]
];

// src/plugin/data-folder.ts
import { chmodSync, mkdirSync } from "node:fs";
var folder = process.env.CLAUDE_PLUGIN_DATA;
if (!folder) throw new Error("cc-huddle runs in Claude Code, which gives it CLAUDE_PLUGIN_DATA");
mkdirSync(folder, { recursive: true });
chmodSync(folder, 448);
var dataFolder = folder;

// src/shared/layout.ts
import { createHash } from "node:crypto";
import path2 from "node:path";
function repoFolder(dataFolder2, repo) {
  const name = path2.basename(repo.top).replace(/[^\w.-]+/g, "-");
  const hash = createHash("sha256").update(repo.common).digest("hex").slice(0, 12);
  return path2.join(dataFolder2, "repos", `${name}-${hash}`);
}
var goalsFolder = (repoFolder2) => path2.join(repoFolder2, "goals");
var goalFolder = (repoFolder2, slug) => path2.join(goalsFolder(repoFolder2), slug);
var sessionsFolder = (dataFolder2) => path2.join(dataFolder2, "sessions");
var depsFolder = (dataFolder2) => path2.join(dataFolder2, "deps");
var goalFiles = (folder2) => ({
  state: path2.join(folder2, "state.json"),
  lock: path2.join(folder2, "lock"),
  members: path2.join(folder2, "members.json"),
  /** The goal's copy of the team (team.ts copyTeam). */
  team: path2.join(folder2, "team.json"),
  /** A member's settings file (policy.ts writeSettings). */
  settings: (member) => path2.join(folder2, "settings", `${member}.json`),
  /** The worktree the goal's branch is checked out in. */
  checkout: path2.join(folder2, "checkout"),
  /** The worktree a subtask works in. */
  desk: (subtaskId) => path2.join(folder2, "desks", subtaskId),
  /** What a subtask's runs did (records.ts). */
  record: (subtaskId) => path2.join(folder2, "records", `${subtaskId}.jsonl`),
  /** An approved plan's document. */
  plan: (meetingId) => path2.join(folder2, "plans", `${meetingId}.md`)
});

export {
  __require,
  __commonJS,
  __toESM,
  errorText,
  errorCode,
  ifThere,
  exists,
  textIfThere,
  jsonIfThere,
  namesIfThere,
  renameOver,
  writeWhole,
  running,
  windowsProcessField,
  dataFolder,
  repoFolder,
  goalsFolder,
  goalFolder,
  sessionsFolder,
  depsFolder,
  goalFiles
};

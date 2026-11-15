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

// src/engine/core.ts
var workOf = (core) => ({
  ...core.state,
  members: core.team.members.map((m) => m.name),
  underWay: core.underWay()
});
function spend(state, member, tokens) {
  state.tokens[member] = (state.tokens[member] ?? 0) + tokens;
}
var errorText = (error) => error instanceof Error ? error.message : String(error);
var errorCode = (error) => error.code;

// src/engine/files.ts
import { renameSync, writeFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
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
var fresh = (file) => `${file}.${String(process.pid)}.new`;
async function writeWhole(file, text, mode) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(fresh(file), text, { mode });
  await renameOver(fresh(file), file);
}
function writeWholeSync(file, text) {
  writeFileSync(fresh(file), text);
  renameSync(fresh(file), file);
}

// src/engine/running.ts
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

// src/plugin/data-folder.ts
var folder = process.env.CLAUDE_PLUGIN_DATA;
if (!folder) throw new Error("openplan runs in Claude Code, which gives it CLAUDE_PLUGIN_DATA");
var dataFolder = folder;

export {
  __require,
  __commonJS,
  __toESM,
  workOf,
  spend,
  errorText,
  errorCode,
  renameOver,
  writeWhole,
  writeWholeSync,
  running,
  dataFolder
};

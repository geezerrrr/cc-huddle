import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// src/plugin/permission-mode.ts
import { text } from "node:stream/consumers";

// src/plugin/data-folder.ts
import { chmodSync, mkdirSync } from "node:fs";
var folder = process.env.CLAUDE_PLUGIN_DATA;
if (!folder) throw new Error("openplan runs in Claude Code, which gives it CLAUDE_PLUGIN_DATA");
mkdirSync(folder, { recursive: true });
chmodSync(folder, 448);
var dataFolder = folder;

// src/plugin/session-mode.ts
import { readdir as readdir2, rm } from "node:fs/promises";
import path3 from "node:path";

// src/shared/files.ts
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// src/shared/errors.ts
var errorCode = (error) => error.code;

// src/shared/files.ts
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
async function writeWhole(file, text2, mode) {
  await mkdir(path.dirname(file), { recursive: true });
  const beside = fresh(file);
  await writeFile(beside, text2, { mode });
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

// src/shared/layout.ts
import path2 from "node:path";
function sessionModes(dataFolder2) {
  const folder2 = path2.join(dataFolder2, "sessions");
  return {
    folder: folder2,
    file: (pid) => path2.join(folder2, `${String(pid)}.mode`),
    /** The session a file in the folder is kept for; undefined for a file that isn't a mode. */
    pidOf: (name) => {
      const { name: pid, ext } = path2.parse(name);
      return ext === ".mode" ? Number(pid) : void 0;
    }
  };
}

// src/plugin/session-mode.ts
var MODES = [
  "default",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions"
];
async function keepMode(dataFolder2, session, mode) {
  if (!MODES.includes(mode)) return;
  const modes = sessionModes(dataFolder2);
  await writeWhole(modes.file(session), mode);
  for (const name of await readdir2(modes.folder)) {
    const pid = modes.pidOf(name);
    if (pid !== void 0 && !running(pid))
      await rm(path3.join(modes.folder, name), { force: true });
  }
}

// src/plugin/permission-mode.ts
var input = JSON.parse(await text(process.stdin));
await keepMode(dataFolder, process.ppid, input.permission_mode);

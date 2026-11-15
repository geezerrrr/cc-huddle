import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// src/plugin/permission-mode.ts
import { text } from "node:stream/consumers";

// src/plugin/data-folder.ts
var folder = process.env.CLAUDE_PLUGIN_DATA;
if (!folder) throw new Error("openplan runs in Claude Code, which gives it CLAUDE_PLUGIN_DATA");
var dataFolder = folder;

// src/plugin/session-mode.ts
import { readdir, rm } from "node:fs/promises";
import path2 from "node:path";

// src/engine/files.ts
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// src/engine/core.ts
var errorCode = (error) => error.code;

// src/engine/files.ts
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
async function writeWhole(file, text2, mode) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(fresh(file), text2, { mode });
  await renameOver(fresh(file), file);
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

// src/plugin/session-mode.ts
var MODES = [
  "default",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions"
];
var folderOf = (dataFolder2) => path2.join(dataFolder2, "sessions");
var fileOf = (dataFolder2, session) => path2.join(folderOf(dataFolder2), `${String(session)}.mode`);
async function keepMode(dataFolder2, session, mode) {
  if (!MODES.includes(mode)) return;
  await writeWhole(fileOf(dataFolder2, session), mode);
  for (const name of await readdir(folderOf(dataFolder2))) {
    const { name: pid, ext } = path2.parse(name);
    if (ext === ".mode" && !running(Number(pid)))
      await rm(path2.join(folderOf(dataFolder2), name), { force: true });
  }
}

// src/plugin/permission-mode.ts
var input = JSON.parse(await text(process.stdin));
await keepMode(dataFolder, process.ppid, input.permission_mode);

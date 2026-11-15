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
var fresh = (file) => `${file}.${String(process.pid)}.new`;
async function writeWhole(file, text2, mode) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(fresh(file), text2, { mode });
  await rename(fresh(file), file);
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

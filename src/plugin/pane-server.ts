/**
 * The team as the pane draws it (docs/design.md §7.2), served on a socket of
 * the pane's own. The pane asks twice a second, so it can't ask through
 * `$.mcp.call`: Claude Code runs that as a tool call, with your PreToolUse
 * and PostToolUse hooks around it. Its only route reads; what you answer goes
 * through the `answer` tool. The mod learns the socket from the `pane` tool.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import { z } from "zod";
import type { OpenplanView } from "../../plugin/types/index.d.ts";
import { errorText, workOf } from "../engine/core.ts";
import type { Engine } from "../engine/engine.ts";
import { paneTeam, shownMeeting } from "./pane.ts";

const viewSchema = z.object({
  /** The revision the pane has. */
  revision: z.number().int().optional(),
  /** The subtask whose record the pane follows, and the byte it read up to. */
  record: z.object({ subtask: z.string(), from: z.number().int().min(0) }).optional(),
});

/** The team as the pane draws it: the team only when it changed since `revision`. */
export async function paneView(
  engine: Engine,
  { revision, record }: z.infer<typeof viewSchema>,
): Promise<OpenplanView> {
  const work = workOf(engine);
  const meeting = shownMeeting(work);
  const spoken = meeting && engine.records.speaking(meeting);
  return {
    revision: engine.revision,
    ...(revision !== engine.revision && { team: paneTeam(work, engine.team.members) }),
    ...(spoken && { speaking: { speaker: spoken.speaker, text: spoken.text } }),
    ...(record && {
      record: {
        subtask: record.subtask,
        ...(await engine.records.read(record.subtask, record.from)),
      },
    }),
  };
}

export interface PaneServer {
  /** The socket's path: a named pipe on Windows. */
  address: string;
  /** Stops serving and removes the socket; at once, as the process may be exiting. */
  close(): void;
}

/**
 * A socket only you can reach: in a folder of its own, made for you alone,
 * or a named pipe on Windows, under a name nobody can guess.
 */
function socketAddress(): { address: string; folder?: string } {
  if (process.platform === "win32")
    return { address: `\\\\.\\pipe\\openplan-${randomBytes(12).toString("hex")}` };
  const folder = mkdtempSync(path.join(tmpdir(), "openplan-"));
  return { address: path.join(folder, "pane.sock"), folder };
}

async function viewOf(team: () => Promise<Engine>, request: IncomingMessage) {
  const asked = viewSchema.parse(JSON.parse((await text(request)) || "{}"));
  return paneView(await team(), asked);
}

/** Serves `POST /view`; the team opens on the first ask, if it isn't open (`team`). */
export async function servePane(team: () => Promise<Engine>): Promise<PaneServer> {
  const { address, folder } = socketAddress();
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/view") {
      response.writeHead(404).end();
      return;
    }
    viewOf(team, request).then(
      (view) => {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(view));
      },
      (error: unknown) => {
        // The team can't be opened, or the ask doesn't fit: the pane shows why.
        response.writeHead(409, { "content-type": "text/plain" }).end(errorText(error));
      },
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject).listen(address, resolve);
  });
  return {
    address,
    close() {
      server.close();
      if (folder) rmSync(folder, { recursive: true, force: true });
    },
  };
}

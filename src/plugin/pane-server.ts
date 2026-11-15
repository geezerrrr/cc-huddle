/**
 * The team as the pane draws it (docs/design.md §7.2), served on a socket of
 * the pane's own. The pane asks twice a second, so it can't ask through
 * `$.mcp.call`: Claude Code runs that as a tool call, with your PreToolUse
 * and PostToolUse hooks around it. `/view` reads; what you answer goes
 * through the `answer` tool. The mod learns the socket from the `pane` tool.
 * The lock names the socket too, so another of your sessions taking the
 * team over asks here for it to be let go (`/release`, §3.2).
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import { z } from "zod";
import type { OpenplanView } from "../../plugin/types/index.d.ts";
import { errorText, workOf } from "../engine/core.ts";
import type { HandedOver } from "../engine/data.ts";
import type { Engine } from "../engine/engine.ts";
import { paneTeam, shownMeeting } from "./pane.ts";

const viewSchema = z.object({
  /** The revision the pane has. */
  revision: z.number().int().optional(),
  /** The subtask whose record the pane follows, and the byte it read up to. */
  record: z.object({ subtask: z.string(), from: z.number().int().min(0) }).optional(),
  /** You turned to openplan in this session: the team is taken over from another that holds it. */
  take: z.boolean().optional(),
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

async function viewOf(team: (take: boolean) => Promise<Engine>, request: IncomingMessage) {
  const asked = viewSchema.parse(JSON.parse((await text(request)) || "{}"));
  return paneView(await team(asked.take ?? false), asked);
}

/**
 * Serves `POST /view`, which opens the team on the first ask (`team`), and
 * `POST /release`, which lets it go and answers with what that stopped (`letGo`).
 */
export async function servePane(
  team: (take: boolean) => Promise<Engine>,
  letGo: () => Promise<HandedOver>,
): Promise<PaneServer> {
  const { address, folder } = socketAddress();
  const server = createServer((request, response) => {
    const route =
      request.method === "POST" &&
      { "/view": () => viewOf(team, request), "/release": letGo }[request.url ?? ""];
    if (!route) {
      response.writeHead(404).end();
      return;
    }
    route().then(
      (view) => {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(view));
      },
      (error: unknown) => {
        // The team can't be opened or closed, or the ask doesn't fit: the asker shows why.
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

/** Asks the server at `address` to let the team go to this one: what it stopped, or why it can't. */
export function askToLetGo(address: string): Promise<HandedOver> {
  return new Promise((resolve, reject) => {
    const asking = request({ socketPath: address, path: "/release", method: "POST" }, (answer) => {
      text(answer).then((body) => {
        if (answer.statusCode === 200) resolve(JSON.parse(body) as HandedOver);
        else reject(new Error(body));
      }, reject);
    });
    asking.once("error", reject).end();
  });
}

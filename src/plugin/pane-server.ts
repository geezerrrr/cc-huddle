/**
 * The team as the pane draws it (docs/design.md §7.2), served on a socket of
 * the pane's own. The pane asks twice a second, so it can't ask through
 * `$.mcp.call`: Claude Code runs that as a tool call, with your PreToolUse
 * and PostToolUse hooks around it. `/view` reads; what you answer goes
 * through the `answer` tool. The mod learns the socket from the `pane` tool.
 * A goal's lock names the socket too, so another of your sessions taking the
 * goal up asks here for it to be let go (`/release`, §3.2).
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import { z } from "zod";
import type { OpenplanTeam, OpenplanView } from "../../plugin/types/index.d.ts";
import { errorText, workOf } from "../engine/core.ts";
import type { GoalEntry, HandedOver } from "../engine/data.ts";
import { paneTeam, shownMeeting, viewEntries, viewLive } from "./pane.ts";
import type { Session } from "./session.ts";

const viewSchema = z.object({
  /** The revision the pane has. */
  revision: z.number().int().optional(),
  /** The subtask whose record the pane follows, and the byte it read up to. */
  record: z.object({ subtask: z.string(), from: z.number().int().min(0) }).optional(),
});

const releaseSchema = z.object({ goal: z.string() });

/** How often the pane's view reads the repository's goals from their folders, as it polls. */
const GOALS_MS = 2000;

/**
 * The view for a session (`session`): the team only when it changed since
 * the revision the pane has. As the pane polls, the repository's goals are
 * read again every GOALS_MS; a look without a revision reads them at once.
 */
function viewer(session: () => Session) {
  let revision = 0;
  let shown = "";
  let goals: { at: number; entries: Promise<GoalEntry[]> } | undefined;
  return async (asked: z.infer<typeof viewSchema>): Promise<OpenplanView> => {
    if (!goals || asked.revision === undefined || Date.now() - goals.at >= GOALS_MS)
      goals = { at: Date.now(), entries: session().goals() };
    const all = await goals.entries.catch((error: unknown) => {
      goals = undefined;
      throw error;
    });
    const entries = session().othersOf(all);
    const engine = session().current;
    const mine = engine && { work: workOf(engine), members: engine.team.members };
    const team: OpenplanTeam = paneTeam(mine, entries, session().moved);
    const text = JSON.stringify(team);
    if (text !== shown) {
      shown = text;
      revision++;
    }
    const meeting = mine && shownMeeting(mine.work);
    const spoken = meeting && engine.records.speaking(meeting);
    const { record } = asked;
    const read = record && engine && (await engine.records.read(record.subtask, record.from));
    return {
      revision,
      ...(asked.revision !== revision && { team }),
      ...(spoken && {
        speaking: {
          speaker: spoken.speaker,
          entries: viewEntries(spoken.entries),
          live: viewLive(spoken.live),
        },
      }),
      ...(read && {
        record: {
          subtask: record.subtask,
          entries: viewEntries(read.entries),
          next: read.next,
          ...(read.live && { live: viewLive(read.live) }),
        },
      }),
    };
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

const asked = async <T>(schema: z.ZodType<T>, request: IncomingMessage) =>
  schema.parse(JSON.parse((await text(request)) || "{}"));

/**
 * Serves `POST /view`, the session's goal and the repository's others as the
 * pane draws them, and `POST /release`, which lets the goal it names go and
 * answers with what that stopped (Session.letGo).
 */
export async function servePane(session: () => Session): Promise<PaneServer> {
  const { address, folder } = socketAddress();
  const view = viewer(session);
  const server = createServer((request, response) => {
    const routes: Record<string, () => Promise<unknown>> = {
      "/view": async () => view(await asked(viewSchema, request)),
      "/release": async () => session().letGo((await asked(releaseSchema, request)).goal),
    };
    const route = request.method === "POST" && routes[request.url ?? ""];
    if (!route) {
      response.writeHead(404).end();
      return;
    }
    route().then(
      (answer) => {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer));
      },
      (error: unknown) => {
        // The goals can't be read or let go, or the ask doesn't fit: the asker shows why.
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

/** Asks the server at `address` to let the goal `slug` go to this one: what it stopped, or why it can't. */
export function askToLetGo(address: string, slug: string): Promise<HandedOver> {
  return new Promise((resolve, reject) => {
    const asking = request({ socketPath: address, path: "/release", method: "POST" }, (answer) => {
      text(answer).then((body) => {
        if (answer.statusCode === 200) resolve(JSON.parse(body) as HandedOver);
        else reject(new Error(body));
      }, reject);
    });
    asking.once("error", reject).end(JSON.stringify({ goal: slug }));
  });
}

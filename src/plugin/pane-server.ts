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
import type { HuddleAsk, HuddleTeam, HuddleView } from "../../plugin/types/index.d.ts";
import { errorCode, errorText } from "../shared/errors.ts";
import { GitError, type GoalEntry, type HandedOver } from "../engine/index.ts";
import { followedOf, paneTeam, shownMeeting, viewEntries, viewLive } from "./pane.ts";
import type { Session } from "./session.ts";

const next = z.number().int().min(0);

const askSchema = z.object({
  revision: z.number().int().optional(),
  record: z
    .object({
      member: z.string(),
      subtask: z.string().optional(),
      read: z.object({ subtask: z.string(), next }).optional(),
    })
    .optional(),
  speaking: z.object({ speech: z.string(), next }).optional(),
}) satisfies z.ZodType<HuddleAsk>;

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
  return async (asked: HuddleAsk): Promise<HuddleView> => {
    if (!goals || asked.revision === undefined || Date.now() - goals.at >= GOALS_MS)
      goals = { at: Date.now(), entries: session().goals() };
    const all = await goals.entries.catch((error: unknown) => {
      goals = undefined;
      throw error;
    });
    const entries = session().othersOf(all);
    const engine = session().current;
    const mine = engine && { work: engine.work, members: engine.team.members };
    const team: HuddleTeam = paneTeam(mine, entries, session());
    const text = JSON.stringify(team);
    if (text !== shown) {
      shown = text;
      revision++;
    }
    const meeting = engine && shownMeeting(engine.work);
    const speaker = meeting && engine.work.meetingsNow[meeting.id]?.speaking?.member;
    const spoken =
      engine &&
      meeting &&
      speaker !== undefined &&
      engine.records.speaking(meeting, asked.speaking);
    // The member's record from where the pane read it, or from its start once they are on other work.
    const followed =
      asked.record && engine && followedOf(asked.record.member, engine.work, asked.record.subtask);
    const { read } = asked.record ?? {};
    const record =
      followed &&
      (await engine.records.read(followed.id, read?.subtask === followed.id ? read.next : 0));
    return {
      revision,
      ...(asked.revision !== revision && { team }),
      ...(spoken && {
        speaking: {
          speech: spoken.speech,
          speaker,
          entries: viewEntries(spoken.entries),
          next: spoken.next,
          live: viewLive(spoken.live),
        },
      }),
      ...(record && {
        record: {
          subtask: followed.id,
          entries: viewEntries(record.entries),
          next: record.next,
          ...(record.live && { live: viewLive(record.live) }),
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
    return { address: `\\\\.\\pipe\\huddle-${randomBytes(12).toString("hex")}` };
  const folder = mkdtempSync(path.join(tmpdir(), "cc-huddle-"));
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
      "/view": async () => view(await asked(askSchema, request)),
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
        // An ask that doesn't fit (400); not in a repository, so there are no goals
        // to read (409: the pane stops asking until you turn to cc-huddle); anything
        // else, the asker shows why (500).
        const status =
          error instanceof z.ZodError || error instanceof SyntaxError
            ? 400
            : error instanceof GitError
              ? 409
              : 500;
        response.writeHead(status, { "content-type": "text/plain" }).end(errorText(error));
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

/** Asks the server at `address` to let the goal `slug` go to this one: what it stopped, or why it can't; undefined when nothing answers there, the server having ended. */
export function askToLetGo(address: string, slug: string): Promise<HandedOver | undefined> {
  return new Promise((resolve, reject) => {
    const asking = request({ socketPath: address, path: "/release", method: "POST" }, (answer) => {
      text(answer).then((body) => {
        if (answer.statusCode === 200) resolve(JSON.parse(body) as HandedOver);
        else reject(new Error(body));
      }, reject);
    });
    asking
      .once("error", (error) => {
        // Nothing listens there: the server that held the goal has ended.
        if (errorCode(error) === "ENOENT" || errorCode(error) === "ECONNREFUSED")
          resolve(undefined);
        else reject(error);
      })
      .end(JSON.stringify({ goal: slug }));
  });
}

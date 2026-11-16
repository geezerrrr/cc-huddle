/**
 * The mod keeping up with the team: it polls the view, keeps what changed
 * for the drawings, and tells what is new: a need is asked, a milestone is a
 * transcript row, and what needs a conversation is a prompt to your session.
 */
import type { EngineInterface, Timer } from "claude-code";
import type { HuddleAnswer, HuddleNeed, HuddleRun, HuddleTeam } from "../types";
import { askNeed } from "./ask";
import { NoRepository, call, view } from "./server";
import {
  changeFollowed,
  changePicks,
  changeSentBack,
  changeProblem,
  changeSpeaking,
  keepTeam,
  readFollowed,
  readSpeaking,
} from "./state";
import { words } from "./text";

/** How often the pane asks the team how it stands. */
const POLL_MS = 500;
/** How many of a run's entries the pane keeps. */
const RUN_KEEP = 200;

/** The revision of the team the pane has. */
let revision: number | undefined;
/** Milestones and prompts told already; those there at the first look are not news. */
let told: Set<string> | undefined;
/** How many goals the session had opened at the last look (HuddleTeam.opened). */
let opened: number | undefined;
let polling = false;
/** Needs put to you in a question dialog already; one dismissed waits in the pane. */
const asked = new Set<string>();
/** The asks, one after another in the order the needs came. */
let asking = Promise.resolve();
/**
 * The poll, while it runs. It stops when the session isn't in a repository,
 * and starts again when you or your session turn to cc-huddle.
 */
let ticking: Timer | undefined;

/** Polls the team, unless it does already. */
export function watch($: EngineInterface) {
  ticking ??= $.clock.every(POLL_MS, () => void poll($));
}

/**
 * Answers a need as it was pressed or said, and looks again at once, so the
 * pane doesn't show it open; what the team refuses is shown.
 */
export async function answer($: EngineInterface, need: HuddleNeed, given: HuddleAnswer) {
  try {
    await call($, "answer", { question: need.id, answer: given });
  } catch (error) {
    $.ui.toast(`cc-huddle: ${words(error)}`);
    return;
  }
  const left = <T>(all: Record<string, T>) =>
    Object.fromEntries(Object.entries(all).filter(([id]) => id !== need.id));
  await changePicks($, left);
  await changeSentBack($, left);
  await poll($);
}

/**
 * Tells what is new: each need not asked yet is asked, in turn, but a task to
 * accept, which is your session's to ask; since the last look, a row for a
 * milestone and a prompt to your session for what needs a conversation. In
 * a goal just opened here, the milestones so far are not news.
 */
function tell($: EngineInterface, now: HuddleTeam) {
  for (const need of now.needs) {
    if (asked.has(need.id) || !need.ask) continue;
    asked.add(need.id);
    asking = asking.then(() => askNeed($, need, (given) => answer($, need, given)));
  }
  const fresh = now.opened !== opened;
  opened = now.opened;
  if (told) {
    if (!fresh)
      for (const milestone of now.milestones)
        if (!told.has(milestone.key)) $.ui.log(`cc-huddle: ${milestone.text}`);
    for (const prompt of now.prompts)
      if (!told.has(prompt.key))
        $.prompt.submit({ text: prompt.text }).catch((error: unknown) => {
          $.ui.toast(`cc-huddle: your session couldn't be told: ${words(error)}`);
        });
  }
  told = new Set([
    ...(told ?? []),
    ...now.milestones.map((m) => m.key),
    ...now.prompts.map((p) => p.key),
  ]);
}

/**
 * A run as the pane keeps it, with what a read (`got`) brought: added to
 * what it had when the read is of the same run (`same`), else in its place;
 * none when the read brought none.
 */
function caughtUp<T extends HuddleRun>(
  had: T | undefined,
  got: T | undefined,
  same: (a: T, b: T) => boolean,
): T | undefined {
  if (!got) return undefined;
  if (!had || !same(had, got)) return { ...got, entries: got.entries.slice(-RUN_KEEP) };
  if (!got.entries.length && JSON.stringify(got.live) === JSON.stringify(had.live)) return had;
  return { ...got, entries: [...had.entries, ...got.entries].slice(-RUN_KEEP) };
}

/** Asks the team how it stands, and keeps what changed for the drawings. */
async function poll($: EngineInterface) {
  if (polling) return;
  polling = true;
  try {
    const following = await readFollowed($);
    const said = await readSpeaking($);
    const had = following?.record;
    const now = await view($, {
      ...(revision !== undefined && { revision }),
      ...(following && {
        record: {
          member: following.member,
          ...(had && { read: { subtask: had.subtask, next: had.next } }),
        },
      }),
      ...(said && { speaking: { speech: said.speech, next: said.next } }),
    });
    revision = now.revision;
    await changeProblem($, () => null);
    if (now.team) {
      // Kept first: an ask looks there for whether its need is still open.
      await keepTeam($, now.team);
      tell($, now.team);
    }
    await changeSpeaking(
      $,
      (was) => caughtUp(was ?? undefined, now.speaking, (a, b) => a.speech === b.speech) ?? null,
    );
    // Only onto the record the read was from: you may have followed another meanwhile.
    await changeFollowed($, (was) => {
      if (was?.member !== following?.member || was?.record?.next !== had?.next) return was;
      const record = caughtUp(had, now.record, (a, b) => a.subtask === b.subtask);
      return was && { member: was.member, ...(record && { record }) };
    });
  } catch (error) {
    // Outside a repository it waits for you; anything else is asked again.
    if (error instanceof NoRepository) {
      ticking?.cancel();
      ticking = undefined;
      await keepTeam($, null);
    }
    const why = words(error);
    revision = undefined;
    await changeProblem($, (was) => (was === why ? was : why));
  } finally {
    polling = false;
  }
}

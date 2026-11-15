/**
 * What the mod keeps for the session, as atoms the drawings read: the team
 * as the server last served it, the speech at the meeting and the followed
 * member's record as read so far, why there is no team, the tab shown, and
 * picks made on a need not answered yet. Each is read and changed here only:
 * the state scan reads an atom where it is declared.
 */
import { atom, read, update } from "claude-code";
import type { EngineInterface } from "claude-code";
import type { OpenplanRecord, OpenplanSpeaking, OpenplanTab, OpenplanTeam } from "../types";

type $ = EngineInterface;
type Change<T> = (was: T) => T;

/** This plugin: as `next.origin` names the caller of a `$` call, and its server (the atoms spell it out: the state scan reads literals). */
export const PLUGIN = "openplan";
/** The pane, which has the plugin's name. */
export const PANE = PLUGIN;

const team = atom({ plugin: "openplan", key: "team" } as const, null, { shape: "team-5" });
const speaking = atom({ plugin: "openplan", key: "speaking" } as const, null, {
  shape: "speaking-4",
});
const followed = atom({ plugin: "openplan", key: "followed" } as const, null, {
  shape: "followed-1",
});
const problem = atom({ plugin: "openplan", key: "problem" } as const, null);
const tab = atom({ plugin: "openplan", key: "tab" } as const, "team");
const picks = atom({ plugin: "openplan", key: "picks" } as const, {});

export type Followed = { member: string; record?: OpenplanRecord } | null;

export function readTeam($: $) {
  return read($, team);
}
export function keepTeam($: $, now: OpenplanTeam | null) {
  return update($, team, () => now);
}
export function readSpeaking($: $) {
  return read($, speaking);
}
export function changeSpeaking($: $, change: Change<OpenplanSpeaking | null>) {
  return update($, speaking, change);
}
export function readFollowed($: $) {
  return read($, followed);
}
export function changeFollowed($: $, change: Change<Followed>) {
  return update($, followed, change);
}
export function readProblem($: $) {
  return read($, problem);
}
export function changeProblem($: $, change: Change<string | null>) {
  return update($, problem, change);
}
export function readTab($: $) {
  return read($, tab);
}
export function keepTab($: $, shown: OpenplanTab) {
  return update($, tab, () => shown);
}
export function readPicks($: $) {
  return read($, picks);
}
export function changePicks($: $, change: Change<Record<string, string[]>>) {
  return update($, picks, change);
}

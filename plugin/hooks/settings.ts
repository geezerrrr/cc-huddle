/**
 * `/huddle review`, `/huddle meeting` and `/huddle parallel` (§6.1):
 * switched as `/model` is, to the value given, or picked in the question
 * dialog.
 */
import type { EngineInterface } from "claude-code";
import { call } from "./server";

const SIZES = ["small", "discussion", "large"] as const;

/** What you pick in the question dialog; none when you dismiss it. */
async function picked($: EngineInterface, question: string, header: string, options: string[]) {
  try {
    return await $.ui.ask(question, { options, header });
  } catch {
    return undefined;
  }
}

/** On or off: `value`, or what you pick when asked `question`; undefined when nothing is picked, or a reply saying what is wrong. */
async function onOff(
  $: EngineInterface,
  value: string,
  question: string,
  header: string,
): Promise<boolean | string | undefined> {
  const said = value || (await picked($, question, header, ["on", "off"]));
  if (!said) return undefined;
  if (said !== "on" && said !== "off") return `${header} is on or off, not "${said}".`;
  return said === "on";
}

/** Turns review on or off: `value`, or what you pick. */
export async function switchReview($: EngineInterface, value: string): Promise<string> {
  const on = await onOff($, value, "Review deliveries before they merge?", "Review");
  if (on === undefined) return "Nothing switched.";
  if (typeof on === "string") return on;
  return call($, "switch_settings", { review: on });
}

/** Turns parallel work on or off: `value`, or what you pick. */
export async function switchParallel($: EngineInterface, value: string): Promise<string> {
  const on = await onOff($, value, "Let a member do several pieces of work at once?", "Parallel");
  if (on === undefined) return "Nothing switched.";
  if (typeof on === "string") return on;
  return call($, "switch_settings", { parallel: on });
}

/** Sets how long meetings' discussions run: `value`, or what you pick. */
export async function switchMeeting($: EngineInterface, value: string): Promise<string> {
  const said = value || (await picked($, "How long should meetings run?", "Meetings", [...SIZES]));
  if (!said) return "Nothing switched.";
  const size = SIZES.find((s) => s === said);
  if (!size) return `Meetings are ${SIZES.join(", ")}, not "${said}".`;
  return call($, "switch_settings", { meetingSize: size });
}

/**
 * `/huddle review` and `/huddle meeting` (§6.1): switched as `/model` is,
 * to the value given, or picked in the question dialog.
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

/** Turns review on or off: `value`, or what you pick. */
export async function switchReview($: EngineInterface, value: string): Promise<string> {
  const said =
    value || (await picked($, "Review deliveries before they merge?", "Review", ["on", "off"]));
  if (!said) return "Nothing switched.";
  if (said !== "on" && said !== "off") return `Review is on or off, not "${said}".`;
  return call($, "switch_settings", { review: said === "on" });
}

/** Sets how long meetings' discussions run: `value`, or what you pick. */
export async function switchMeeting($: EngineInterface, value: string): Promise<string> {
  const said = value || (await picked($, "How long should meetings run?", "Meetings", [...SIZES]));
  if (!said) return "Nothing switched.";
  const size = SIZES.find((s) => s === said);
  if (!size) return `Meetings are ${SIZES.join(", ")}, not "${said}".`;
  return call($, "switch_settings", { meetingSize: size });
}

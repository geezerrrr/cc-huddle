/**
 * `/openplan pause` and `/openplan resume` (§7.3): what they do; why they
 * do nothing is the view's, the resume dialog and its list the mod's own.
 */
import type { EngineInterface } from "claude-code";
import { call, view } from "./server";

/** Claude Code's question dialog offers at most this many options. */
const ASK_OPTIONS = 4;

/** The goal you pick in the question dialog; none when you dismiss it or type something else. */
async function picked<T extends { label: string }>(
  $: EngineInterface,
  listed: T[],
): Promise<T | undefined> {
  try {
    const said = await $.ui.ask("Which goal should go on?", {
      options: listed.map((g) => g.label),
      header: "Resume",
    });
    return listed.find((g) => g.label === said);
  } catch {
    return undefined;
  }
}

/**
 * Resumes your session's goal or takes up another: the only one; with
 * several, the one you pick in the question dialog, or the one numbered
 * `number` when there are more than it holds, as listed. While your
 * session's goal is active, it says to pause it first.
 */
export async function resumeGoal($: EngineInterface, number?: number): Promise<string> {
  const now = (await view($, {})).team;
  if (now?.resumeRefused) return now.resumeRefused;
  const listed = (now?.resumable ?? []).map((goal, i) => ({
    slug: goal.slug,
    label: `${String(i + 1)}. ${goal.label}`,
  }));
  if (number === undefined && listed.length > ASK_OPTIONS)
    return [
      "Goals; resume one with /openplan resume <number>:",
      ...listed.map((g) => g.label),
    ].join("\n");
  const goal =
    number !== undefined
      ? listed[number - 1]
      : listed.length === 1
        ? listed[0]
        : await picked($, listed);
  if (!goal)
    return number === undefined ? "Nothing resumed." : `No goal is numbered ${String(number)}.`;
  return call($, "resume_goal", { goal: goal.slug });
}

/** Pauses your session's goal; says why where it pauses nothing. */
export async function pauseGoal($: EngineInterface): Promise<string> {
  const refused = (await view($, {})).team?.pauseRefused;
  return refused ?? call($, "goal_action", { action: "pause" });
}

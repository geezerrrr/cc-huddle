/** How the mod fits what it is given into its rows. */

/** How much of a tool's argument, of what is stuck, or of what an option means, a row or the question dialog shows. */
const ROW_TEXT = 300;

export const clip = (text: string, most = ROW_TEXT) =>
  text.length > most ? `${text.slice(0, most)}…` : text;

/**
 * The places, from 0, of the tasks a list of their numbers names, as typed
 * (`1, 3`) or as the dialog joins picked labels (`1: Rules, 3: Tests`); a
 * number that names none is left out.
 */
export const taskPlaces = (text: string, count: number) => [
  ...new Set(
    [...text.matchAll(/(?:^|,)\s*(\d+)/g)]
      .map((m) => Number(m[1]) - 1)
      .filter((i) => i >= 0 && i < count),
  ),
];

/** An error's message, as a failed call is shown. */
export const words = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Text in one line, its runs of space and line breaks one space each. */
export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

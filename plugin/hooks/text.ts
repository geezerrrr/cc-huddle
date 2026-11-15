/** How the mod fits what it is given into its rows. */

/** How much of a tool's argument, of what is stuck, or of what an option means, a row or the question dialog shows. */
const ROW_TEXT = 300;

export const clip = (text: string) =>
  text.length > ROW_TEXT ? `${text.slice(0, ROW_TEXT)}…` : text;

/** An error's message, as a failed call is shown. */
export const words = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Text in one line, its runs of space and line breaks one space each. */
export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

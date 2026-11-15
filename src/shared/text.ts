/** Text helpers every part's words use: a leaf. */

/** Items as a sentence lists them: "a, b and c". */
export const listOf = (items: readonly string[]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(items);

/** What a tool answers, in words: an MCP tool result. */
export const toolText = (text: string) => ({ content: [{ type: "text" as const, text }] });

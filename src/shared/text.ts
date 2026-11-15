/** Text helpers every part's words use: a leaf. */

/** Items as a sentence lists them: "a, b and c". */
export const listOf = (items: readonly string[]) =>
  new Intl.ListFormat("en", { type: "conjunction" }).format(items);

/** Errors in words and by kind: a leaf, for every part. */

/** An error in words. */
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** A system error's code: `ENOENT`, `EEXIST`…; undefined for any other error. */
export const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;

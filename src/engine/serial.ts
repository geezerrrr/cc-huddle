/**
 * Runs tasks one at a time per key, in the order they come, so what two of
 * them share (a goal's branch and worktrees) never moves under the other. A
 * failed task doesn't hold up the next.
 */
export function serialBy() {
  const queues = new Map<string, Promise<unknown>>();
  return function serial<T>(key: string, task: () => T | Promise<T>): Promise<T> {
    const next = (queues.get(key) ?? Promise.resolve()).then(task, task);
    const settled = next.catch(() => undefined);
    queues.set(key, settled);
    // The last task done drops the key, so finished queues don't pile up.
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return next;
  };
}

/**
 * Runs tasks one after another, in the order they come, each failure told to
 * `failed` and the next run all the same; `idle` settles once all so far have run.
 */
export function inOrder(failed: (error: unknown) => void) {
  let tail = Promise.resolve();
  return {
    run(task: () => Promise<void>) {
      tail = tail.then(task).catch(failed);
    },
    idle: () => tail,
  };
}

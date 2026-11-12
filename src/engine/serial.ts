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

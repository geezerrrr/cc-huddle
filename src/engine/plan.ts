/**
 * A meeting's plan (docs/design.md §2): the shape the host hands it back in,
 * and the checks that make it one the scheduler can carry out.
 */
import { z } from "zod";
import type { Plan, PlanSubtask, PlanTask } from "./types.ts";

/** A plan in the shape a model writes it, each subtask going to a member by name (`assignee`). */
export const planSchema = (assignee: z.ZodType<string>) =>
  z.object({
    summary: z.string().trim().describe("The outcome in one sentence"),
    plan_markdown: z.string().trim().describe("The plan document"),
    tasks: z.array(
      z.object({
        title: z.string().trim(),
        outcome: z.string().trim().describe("What the task delivers when accepted"),
        subtasks: z.array(
          z.object({
            key: z.string().trim().describe("A short id, unique within this plan, such as api-1"),
            title: z.string().trim(),
            description: z.string().trim(),
            assignee,
            depends_on: z.array(z.string()).describe("The keys of the subtasks it waits for"),
            acceptance: z.string().trim(),
          }),
        ),
      }),
    ),
  });

/** The host's plan, each subtask going to an attendee. */
export const hostPlanSchema = (attendees: readonly [string, ...string[]]) =>
  planSchema(z.enum(attendees).describe("The name of the attendee it goes to"));

/**
 * The dependencies that close a loop, as [subtask, dependency] pairs. A
 * subtask that waits on one in another task waits on that whole task, so a
 * loop can run through tasks as well as subtasks.
 */
export function loopingDependencies(
  tasks: ReadonlyArray<{ subtasks: ReadonlyArray<Pick<PlanSubtask, "key" | "dependsOn">> }>,
): Array<[string, string]> {
  const taskOf = new Map(tasks.flatMap((t) => t.subtasks.map((s) => [s.key, t] as const)));
  const waitsOn = new Map(tasks.flatMap((t) => t.subtasks.map((s) => [s.key, s.dependsOn])));
  // Depth first: a dependency on a subtask still being followed closes a loop.
  const state = new Map<string, "open" | "done">();
  const loops: Array<[string, string]> = [];
  const follow = (key: string) => {
    state.set(key, "open");
    for (const dependency of waitsOn.get(key) ?? []) {
      const task = taskOf.get(dependency);
      if (!task) continue;
      const awaited = task === taskOf.get(key) ? [dependency] : task.subtasks.map((s) => s.key);
      if (awaited.some((k) => state.get(k) === "open")) loops.push([key, dependency]);
      else for (const k of awaited) if (!state.has(k)) follow(k);
    }
    state.set(key, "done");
  };
  for (const key of waitsOn.keys()) if (!state.has(key)) follow(key);
  return loops;
}

/**
 * The host's plan made sound: keys unique, blanks named, dependencies on
 * keys it doesn't have or that would loop dropped, tasks with no subtasks
 * left out. Throws when it plans nothing.
 */
export function parsePlan(raw: unknown, attendees: readonly [string, ...string[]]): Plan {
  const plan = hostPlanSchema(attendees).parse(raw);
  const used = new Set<string>();
  const tasks: PlanTask[] = plan.tasks
    .filter((task) => task.subtasks.length)
    .map((task, n) => ({
      title: task.title || `Task ${String(n + 1)}`,
      outcome: task.outcome,
      subtasks: task.subtasks.map((sub, i) => {
        let key = sub.key || `t${String(n + 1)}-${String(i + 1)}`;
        while (used.has(key)) key = `${key}'`;
        used.add(key);
        return {
          key,
          title: sub.title || `Subtask ${String(i + 1)}`,
          description: sub.description,
          assignee: sub.assignee,
          dependsOn: sub.depends_on,
          acceptance: sub.acceptance,
        };
      }),
    }));
  if (!tasks.length) throw new Error("The host's plan has no tasks");
  const subtasks = tasks.flatMap((task) => task.subtasks);
  for (const subtask of subtasks)
    subtask.dependsOn = [...new Set(subtask.dependsOn)].filter(
      (key) => key !== subtask.key && used.has(key),
    );
  for (const [key, dependency] of loopingDependencies(tasks)) {
    const subtask = subtasks.find((s) => s.key === key);
    if (subtask) subtask.dependsOn = subtask.dependsOn.filter((k) => k !== dependency);
  }
  return { summary: plan.summary, markdown: plan.plan_markdown, tasks };
}

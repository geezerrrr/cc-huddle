/**
 * A meeting's plan (docs/design.md §2): the shape the host hands it back in,
 * and the checks that make it one the scheduler can carry out.
 */
import { z } from "zod";
import type { Plan, PlanSubtask, PlanTask } from "./types.ts";

/** A task as a model writes it, each subtask going to a member by name (`assignee`). */
const taskShape = (assignee: z.ZodType<string>) => ({
  title: z.string().trim(),
  outcome: z.string().trim().describe("What the task delivers"),
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
});

const planShape = <T extends z.ZodType>(task: T) =>
  z.object({
    summary: z.string().trim().describe("The outcome in one sentence"),
    plan_markdown: z.string().trim().describe("The plan document"),
    tasks: z.array(task),
  });

/**
 * A plan as you change it: the host's, and which tasks you accept yourself
 * once done (§7.1).
 */
export const planSchema = (assignee: z.ZodType<string>) =>
  planShape(
    z.object({
      ...taskShape(assignee),
      owner_accepts: z
        .boolean()
        .default(false)
        .describe("Whether the user accepts this task themselves once it is done"),
    }),
  );

/** The host's plan, each subtask going to a member. Which tasks you accept is yours to say, in review. */
export const hostPlanSchema = (members: readonly [string, ...string[]]) =>
  planShape(z.object(taskShape(z.enum(members).describe("The name of the member it goes to"))));

/** A plan as written: by you, or by the host, with no task for you to accept. */
export type WrittenPlan = z.output<ReturnType<typeof planSchema>>;

/** The host's plan as written: none of its tasks is yours to accept until you tick it. */
export const hostWritten = (plan: z.output<ReturnType<typeof hostPlanSchema>>): WrittenPlan => ({
  ...plan,
  tasks: plan.tasks.map((task) => ({ ...task, owner_accepts: false })),
});

/** A plan written back in the shape it is written in (planSchema), as change_plan takes it. */
export const writtenPlan = (plan: Plan): WrittenPlan => ({
  summary: plan.summary,
  plan_markdown: plan.markdown,
  tasks: plan.tasks.map((task) => ({
    title: task.title,
    outcome: task.outcome,
    owner_accepts: task.ownerAccepts,
    subtasks: task.subtasks.map(({ dependsOn, ...subtask }) => ({
      ...subtask,
      depends_on: dependsOn,
    })),
  })),
});

/**
 * The dependencies that close a loop, as [subtask, dependency] pairs. A
 * subtask that waits on one in another task you accept waits on that whole
 * task, so a loop can run through tasks as well as subtasks.
 */
export function loopingDependencies(
  tasks: ReadonlyArray<
    Pick<PlanTask, "ownerAccepts"> & {
      subtasks: ReadonlyArray<Pick<PlanSubtask, "key" | "dependsOn">>;
    }
  >,
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
      const awaited =
        task.ownerAccepts && task !== taskOf.get(key)
          ? task.subtasks.map((s) => s.key)
          : [dependency];
      if (awaited.some((k) => state.get(k) === "open")) loops.push([key, dependency]);
      else for (const k of awaited) if (!state.has(k)) follow(k);
    }
    state.set(key, "done");
  };
  for (const key of waitsOn.keys()) if (!state.has(key)) follow(key);
  return loops;
}

/**
 * A plan as written made sound: keys unique, blanks named, dependencies on
 * keys it doesn't have dropped, tasks with no subtasks left out. Dependencies
 * that loop are dropped from the host's plan (`loops: "drop"`); in yours they
 * are refused, with which ones they are. Throws when it plans nothing.
 */
export function soundPlan(plan: WrittenPlan, loops: "drop" | "refuse"): Plan {
  const used = new Set<string>();
  const tasks: PlanTask[] = plan.tasks
    .filter((task) => task.subtasks.length)
    .map((task, n) => ({
      title: task.title || `Task ${String(n + 1)}`,
      outcome: task.outcome,
      ownerAccepts: task.owner_accepts,
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
  if (!tasks.length) throw new Error("The plan has no tasks");
  const subtasks = tasks.flatMap((task) => task.subtasks);
  for (const subtask of subtasks)
    subtask.dependsOn = [...new Set(subtask.dependsOn)].filter(
      (key) => key !== subtask.key && used.has(key),
    );
  const looping = loopingDependencies(tasks);
  if (looping.length && loops === "refuse")
    throw new Error(
      `These dependencies go round in a loop, counting a task you accept as waited on whole: ${looping.map(([key, dependency]) => `${key} on ${dependency}`).join(", ")}. Drop them, or accept fewer tasks.`,
    );
  for (const [key, dependency] of looping) {
    const subtask = subtasks.find((s) => s.key === key);
    if (subtask) subtask.dependsOn = subtask.dependsOn.filter((k) => k !== dependency);
  }
  return { summary: plan.summary, markdown: plan.plan_markdown, tasks };
}

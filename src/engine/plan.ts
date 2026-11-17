/**
 * A meeting's plan (docs/design.md §2): the shape the host hands it back in,
 * and the checks that make it one the scheduler can carry out.
 */
import { z } from "zod";
import { PLAN_FIELDS } from "./prompts.ts";
import type { Plan, PlanSubtask, PlanTask } from "./types.ts";

/** A task as a model writes it, each subtask going to a member by name (`assignee`). */
const taskShape = (assignee: z.ZodType<string>) => ({
  title: z.string().trim(),
  outcome: z.string().trim().describe(PLAN_FIELDS.outcome),
  subtasks: z.array(
    z.object({
      key: z.string().trim().describe(PLAN_FIELDS.key),
      title: z.string().trim(),
      description: z.string().trim(),
      assignee,
      depends_on: z.array(z.string()).describe(PLAN_FIELDS.dependsOn),
      acceptance: z.string().trim(),
    }),
  ),
});

const planShape = <T extends z.ZodType>(task: T) =>
  z.object({
    summary: z.string().trim().describe(PLAN_FIELDS.summary),
    plan_markdown: z.string().trim().describe(PLAN_FIELDS.markdown),
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
      owner_accepts: z.boolean().default(false).describe(PLAN_FIELDS.ownerAccepts),
    }),
  );

/** The host's plan, each subtask going to a member. Which tasks you accept is yours to say, in review. */
export const hostPlanSchema = (members: readonly [string, ...string[]]) =>
  planShape(z.object(taskShape(z.enum(members).describe(PLAN_FIELDS.assignee))));

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
 * What keeps a plan as written from being one the scheduler can carry out
 * (docs/design.md §2), each said plainly; none when it can. Nothing in it is
 * fixed for its writer.
 */
export function planFaults(plan: WrittenPlan): string[] {
  const faults: string[] = [];
  if (!plan.tasks.length) faults.push("It has no tasks.");
  for (const task of plan.tasks)
    if (!task.subtasks.length) faults.push(`The task "${task.title}" has no subtasks.`);
  const subtasks = plan.tasks.flatMap((task) => task.subtasks);
  const keys = subtasks.map((s) => s.key);
  if (keys.includes("")) faults.push("A subtask has no key.");
  const twice = [...new Set(keys.filter((key, i) => key && keys.indexOf(key) !== i))];
  if (twice.length) faults.push(`These keys are used more than once: ${twice.join(", ")}.`);
  const unknown = subtasks.flatMap((s) =>
    s.depends_on.filter((key) => !keys.includes(key)).map((key) => `${s.key} on ${key}`),
  );
  if (unknown.length)
    faults.push(`These dependencies name a key no subtask has: ${unknown.join(", ")}.`);
  if (faults.length) return faults;
  const looping = loopingDependencies(
    plan.tasks.map((task) => ({
      ownerAccepts: task.owner_accepts,
      subtasks: task.subtasks.map((s) => ({ key: s.key, dependsOn: s.depends_on })),
    })),
  );
  if (looping.length)
    faults.push(
      `These dependencies go round in a loop, a task the user accepts counting as waited on whole: ${looping.map(([key, dependency]) => `${key} on ${dependency}`).join(", ")}.`,
    );
  return faults;
}

/** A plan as written, as the scheduler takes it; throws, saying why, when it can't carry it out (planFaults). */
export function soundPlan(plan: WrittenPlan): Plan {
  const faults = planFaults(plan);
  if (faults.length) throw new Error(`The plan can't be carried out: ${faults.join(" ")}`);
  return {
    summary: plan.summary,
    markdown: plan.plan_markdown,
    tasks: plan.tasks.map((task) => ({
      title: task.title,
      outcome: task.outcome,
      ownerAccepts: task.owner_accepts,
      subtasks: task.subtasks.map(({ depends_on, ...subtask }) => ({
        ...subtask,
        dependsOn: depends_on,
      })),
    })),
  };
}

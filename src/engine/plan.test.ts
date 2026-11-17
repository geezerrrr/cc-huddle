import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  hostPlanSchema,
  hostWritten,
  loopingDependencies,
  planFaults,
  planSchema,
  soundPlan,
  writtenPlan,
} from "./plan.ts";

const sub = (key: string, depends_on: string[] = [], assignee = "glm") => ({
  key,
  title: key,
  description: "",
  assignee,
  depends_on,
  acceptance: "",
});

const raw = (
  ...tasks: { title?: string; owner_accepts?: boolean; subtasks: ReturnType<typeof sub>[] }[]
) => ({
  summary: "Build the dice game",
  plan_markdown: "# Plan",
  tasks: tasks.map((t) => ({ title: "", outcome: "", ...t })),
});

describe("hostPlanSchema", () => {
  it("lets subtasks go only to the members, and leaves which tasks you accept out", () => {
    const schema = hostPlanSchema(["glm", "sonnet"]);
    expect(schema.safeParse(raw({ subtasks: [sub("a", [], "sonnet")] })).success).toBe(true);
    expect(schema.safeParse(raw({ subtasks: [sub("a", [], "ann")] })).success).toBe(false);
    const written = hostWritten(schema.parse(raw({ owner_accepts: true, subtasks: [sub("a")] })));
    expect(written.tasks[0]?.owner_accepts).toBe(false);
  });
});

describe("loopingDependencies", () => {
  const task = (ownerAccepts: boolean, ...subtasks: [string, string[]][]) => ({
    ownerAccepts,
    subtasks: subtasks.map(([key, dependsOn]) => ({ key, dependsOn })),
  });

  it("finds a loop among subtasks", () => {
    expect(loopingDependencies([task(false, ["a", ["b"]], ["b", ["a"]])])).toEqual([["b", "a"]]);
  });

  it("finds a loop through a task you accept, where waiting on one subtask is waiting on its task", () => {
    // b waits on c's task, which holds d, which waits on a's task.
    expect(
      loopingDependencies([
        task(true, ["a", []], ["b", ["c"]]),
        task(true, ["c", []], ["d", ["a"]]),
      ]),
    ).toEqual([["d", "a"]]);
  });

  it("finds none where the tasks aren't yours to accept: only the subtasks named are waited on", () => {
    expect(
      loopingDependencies([
        task(false, ["a", []], ["b", ["c"]]),
        task(false, ["c", []], ["d", ["a"]]),
      ]),
    ).toEqual([]);
  });

  it("finds none in a plan that only goes one way", () => {
    expect(
      loopingDependencies([task(true, ["a", []], ["b", ["a"]]), task(true, ["c", ["b"]])]),
    ).toEqual([]);
  });
});

describe("soundPlan", () => {
  const yours = (plan: unknown) => planSchema(z.enum(["glm"])).parse(plan);

  it("takes a plan as written, fixing nothing in it", () => {
    const plan = soundPlan(yours(raw({ subtasks: [sub("a"), sub("b", ["a", "a"])] })));
    expect(plan.tasks[0]?.subtasks.map((s) => [s.key, s.dependsOn])).toEqual([
      ["a", []],
      ["b", ["a", "a"]],
    ]);
  });

  it("says each thing that keeps the scheduler from carrying a plan out", () => {
    expect(
      planFaults(
        yours(
          raw({ subtasks: [] }, { subtasks: [sub("a", ["ghost"]), sub("b"), sub("a"), sub("")] }),
        ),
      ),
    ).toEqual([
      'The task "" has no subtasks.',
      "A subtask has no key.",
      "These keys are used more than once: a.",
      "These dependencies name a key no subtask has: a on ghost.",
    ]);
    expect(planFaults(yours(raw({ subtasks: [sub("a", ["a"])] })))[0]).toContain("a on a");
  });

  it("keeps the tasks you accept, and refuses dependencies of yours that loop through them", () => {
    const plan = (accepts: boolean) =>
      yours(
        raw(
          { owner_accepts: accepts, subtasks: [sub("a"), sub("b", ["d"])] },
          { subtasks: [sub("c"), sub("d", ["a"])] },
        ),
      );
    expect(soundPlan(plan(false)).tasks.map((t) => t.ownerAccepts)).toEqual([false, false]);
    expect(() => soundPlan(plan(true))).toThrow("d on a");
  });

  it("refuses a plan with nothing in it", () => {
    expect(() => soundPlan(yours(raw()))).toThrow("It has no tasks");
  });

  it("reads back a plan written out whole (writtenPlan)", () => {
    const plan = soundPlan(
      yours(
        raw(
          { owner_accepts: true, subtasks: [sub("a"), sub("b", ["a"])] },
          { subtasks: [sub("c", ["b"])] },
        ),
      ),
    );
    expect(soundPlan(yours(writtenPlan(plan)))).toEqual(plan);
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { hostPlanSchema, hostWritten, loopingDependencies, planSchema, soundPlan } from "./plan.ts";

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

  it("makes keys unique, names blanks, and drops what it can't keep", () => {
    const plan = soundPlan(
      yours(
        raw(
          { subtasks: [] },
          { subtasks: [sub("a", ["a", "ghost", "b", "b"]), sub("b", ["a"]), sub("a")] },
        ),
      ),
      "drop",
    );
    expect(plan).toEqual({
      summary: "Build the dice game",
      markdown: "# Plan",
      tasks: [
        {
          title: "Task 1",
          outcome: "",
          ownerAccepts: false,
          subtasks: [
            {
              key: "a",
              title: "a",
              description: "",
              assignee: "glm",
              dependsOn: ["b"],
              acceptance: "",
            },
            {
              key: "b",
              title: "b",
              description: "",
              assignee: "glm",
              dependsOn: [],
              acceptance: "",
            },
            {
              key: "a'",
              title: "a",
              description: "",
              assignee: "glm",
              dependsOn: [],
              acceptance: "",
            },
          ],
        },
      ],
    });
  });

  it("keeps the tasks you accept, and refuses dependencies of yours that loop through them", () => {
    const plan = (accepts: boolean) =>
      yours(
        raw(
          { owner_accepts: accepts, subtasks: [sub("a"), sub("b", ["d"])] },
          { subtasks: [sub("c"), sub("d", ["a"])] },
        ),
      );
    expect(soundPlan(plan(false), "refuse").tasks.map((t) => t.ownerAccepts)).toEqual([
      false,
      false,
    ]);
    expect(() => soundPlan(plan(true), "refuse")).toThrow("d on a");
  });

  it("refuses a plan with nothing in it", () => {
    expect(() => soundPlan(yours(raw({ subtasks: [] })), "drop")).toThrow("no tasks");
  });
});

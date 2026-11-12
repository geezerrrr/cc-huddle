import { describe, expect, it } from "vitest";
import { hostPlanSchema, loopingDependencies, parsePlan } from "./plan.ts";

const sub = (key: string, depends_on: string[] = [], assignee = "glm") => ({
  key,
  title: key,
  description: "",
  assignee,
  depends_on,
  acceptance: "",
});

const raw = (...tasks: { title?: string; subtasks: ReturnType<typeof sub>[] }[]) => ({
  summary: "Build the dice game",
  plan_markdown: "# Plan",
  tasks: tasks.map((t) => ({ title: "", outcome: "", ...t })),
});

describe("hostPlanSchema", () => {
  it("lets subtasks go only to the attendees", () => {
    const schema = hostPlanSchema(["glm", "sonnet"]);
    expect(schema.safeParse(raw({ subtasks: [sub("a", [], "sonnet")] })).success).toBe(true);
    expect(schema.safeParse(raw({ subtasks: [sub("a", [], "ann")] })).success).toBe(false);
  });
});

describe("loopingDependencies", () => {
  const task = (...subtasks: [string, string[]][]) => ({
    subtasks: subtasks.map(([key, dependsOn]) => ({ key, dependsOn })),
  });

  it("finds a loop among subtasks", () => {
    expect(loopingDependencies([task(["a", ["b"]], ["b", ["a"]])])).toEqual([["b", "a"]]);
  });

  it("finds a loop through tasks, where waiting on one subtask is waiting on its task", () => {
    // b waits on c's task, which holds d, which waits on a's task.
    expect(
      loopingDependencies([task(["a", []], ["b", ["c"]]), task(["c", []], ["d", ["a"]])]),
    ).toEqual([["d", "a"]]);
  });

  it("finds none in a plan that only goes one way", () => {
    expect(loopingDependencies([task(["a", []], ["b", ["a"]]), task(["c", ["b"]])])).toEqual([]);
  });
});

describe("parsePlan", () => {
  it("makes keys unique, names blanks, and drops what it can't keep", () => {
    const plan = parsePlan(
      raw(
        { subtasks: [] },
        { subtasks: [sub("a", ["a", "ghost", "b", "b"]), sub("b", ["a"]), sub("a")] },
      ),
      ["glm"],
    );
    expect(plan).toEqual({
      summary: "Build the dice game",
      markdown: "# Plan",
      tasks: [
        {
          title: "Task 1",
          outcome: "",
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

  it("refuses a plan with nothing in it", () => {
    expect(() => parsePlan(raw({ subtasks: [] }), ["glm"])).toThrow("no tasks");
  });
});

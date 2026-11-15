import { describe, expect, it } from "vitest";
import { actionEvent, can, MEETING_MACHINE, step, SUBTASK_MACHINE } from "./machines.ts";

describe("state machines", () => {
  it("moves along a listed transition", () => {
    expect(step(SUBTASK_MACHINE, "pending", "start")).toBe("running");
    expect(step(SUBTASK_MACHINE, "reviewing", "reject")).toBe("pending");
    expect(step(MEETING_MACHINE, "failed", "resume")).toBe("running");
  });

  it("refuses a move the table lacks", () => {
    expect(() => step(SUBTASK_MACHINE, "done", "start")).toThrow('No "start" from "done"');
    expect(() => step(MEETING_MACHINE, "approved", "resume")).toThrow();
  });

  it("answers what may happen where", () => {
    expect(can(SUBTASK_MACHINE, "merging", "stopMerge")).toBe(true);
    expect(can(SUBTASK_MACHINE, "done", "stop")).toBe(false);
    expect(can(SUBTASK_MACHINE, "done", "redo")).toBe(true);
  });

  it("does each of your actions as the event it is where the subtask stands", () => {
    expect(actionEvent("running", "stop")).toBe("stop");
    expect(actionEvent("reviewing", "stop")).toBe("stopReview");
    expect(actionEvent("stoppedInMerge", "continue")).toBe("mergeAgain");
    expect(actionEvent("stoppedInReview", "retry")).toBe("retry");
    expect(actionEvent("done", "stop")).toBeUndefined();
  });
});

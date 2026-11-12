import { describe, expect, it } from "vitest";
import {
  goOnMessage,
  meetingAnswer,
  meetingClosing,
  meetingHand,
  meetingOpening,
  meetingSteer,
  systemPrompt,
  taskBrief,
  teammateQuestion,
  type MeetingBrief,
} from "./prompts.ts";
import type { Meeting, MeetingTurn, Member, Subtask } from "./types.ts";

const member = (name: string, title: string): Member => ({
  name,
  role: { id: title.toLowerCase(), title, duties: `Duties of a ${title}.\n` },
  env: {},
});
const glm = member("glm", "UI designer");
const sonnet = member("sonnet", "Programmer");

const subtask = (id: string, fields: Partial<Subtask> = {}): Subtask => ({
  id,
  taskId: "t1",
  goalId: "g1",
  title: id,
  description: "",
  acceptance: "",
  assignee: "sonnet",
  dependsOn: [],
  status: "done",
  createdAt: 0,
  progress: { done: 0, total: 0 },
  tokens: 0,
  ...fields,
});

describe("systemPrompt", () => {
  it("says who the member is, their duties and their teammates", () => {
    const prompt = systemPrompt("answer", glm, [glm, sonnet]);
    expect(prompt).toContain("You are glm, the UI designer");
    expect(prompt).toContain("Your teammates: sonnet (Programmer).");
    expect(prompt).toContain("# Your duties\nDuties of a UI designer.");
    expect(prompt).not.toContain("deliver");
  });

  it("tells how to work on a subtask only in a working session", () => {
    expect(systemPrompt("task", glm, [glm])).toContain("call deliver");
  });
});

describe("taskBrief", () => {
  it("gives the work, where to do it, its plan, what it builds on, and your words for it", () => {
    const brief = taskBrief({
      goal: { id: "g1", name: "Dice game", slug: "dice-game", status: "active", createdAt: 0 },
      task: { id: "t1", goalId: "g1", title: "Board", outcome: "A board to roll on", createdAt: 0 },
      subtask: subtask("Scoreboard", { acceptance: "Shows both scores" }),
      cwd: "/desks/s2",
      branch: "openplan/dice-game/s2",
      plan: "# Dice game\n\nTwo players.",
      upstream: [
        {
          subtask: subtask("Rules", { delivery: { summary: "Done.", files: ["rules.ts"], at: 0 } }),
          direct: true,
        },
        {
          subtask: subtask("Setup", { delivery: { summary: "Set up.", files: [], at: 0 } }),
          direct: false,
        },
      ],
      notes: [
        { why: "revised", note: "Bigger numbers" },
        { why: "held" },
        { why: "carried", note: "Use blue" },
      ],
    });
    expect(brief).toBe(`Goal: Dice game
Task: Board. A board to roll on

Your subtask: Scoreboard

Acceptance criteria: Shows both scores

Your worktree is /desks/s2, on branch openplan/dice-game/s2.

The plan your team agreed on, which this subtask is part of:

# Dice game

Two players.

It builds on this work, merged into the goal's branch:
- Rules, by sonnet: Done. Files: rules.ts

Which built on:
- Setup, by sonnet: Set up.

The user sent this task back before, asking for:
Bigger numbers

The user adds to your subtask:
Use blue`);
  });
});

describe("goOnMessage", () => {
  it("says each thing that came up once, in the order it came", () => {
    const message = goOnMessage(
      [{ why: "held" }, { why: "rejected" }, { why: "held" }, { why: "carried", note: "Use blue" }],
      subtask("s1", { review: { rounds: 1, notes: "Scores overlap" } }),
    );
    expect(message.split("\n\n")).toEqual([
      "Your work was paused and now goes on. Pick up where you left off.",
      "The review sent your delivery back. Fix what it says, then deliver again:\nScores overlap",
      "The user adds to your subtask:\nUse blue",
    ]);
  });
});

describe("teammateQuestion", () => {
  it("brings the question and what the member asked has done", () => {
    const prompt = teammateQuestion({
      from: glm,
      subtask: subtask("Scoreboard"),
      question: "Which font?",
      own: [subtask("Rules", { delivery: { summary: "Rules in rules.ts", files: [], at: 0 } })],
    });
    expect(prompt).toContain('glm (UI designer) asks you this while working on "Scoreboard"');
    expect(prompt).toContain("- Rules (done): Rules in rules.ts");
  });
});

describe("meeting prompts", () => {
  const meeting = (fields: Partial<Meeting> = {}): Meeting => ({
    id: "m1",
    goalId: "g1",
    agenda: "A two-player dice game",
    size: "small",
    participants: ["sonnet", "glm"],
    host: "sonnet",
    status: "running",
    turns: [],
    tokens: 0,
    createdAt: 0,
    ...fields,
  });
  const brief = (fields: Partial<Meeting> = {}): MeetingBrief => ({
    meeting: meeting(fields),
    goal: { id: "g1", name: "Dice", slug: "dice", status: "active", createdAt: 0 },
    attendees: [sonnet, glm],
    cwd: "/goals/dice",
  });
  const turn = (speaker: string, text: string, phase: MeetingTurn["phase"]): MeetingTurn => ({
    speaker,
    text,
    at: 0,
    phase,
    tokens: 0,
  });

  it("brief an attendee the first time only", () => {
    const opening = meetingOpening(brief());
    expect(opening).toMatch(/^You're hosting a planning meeting\.\nGoal: Dice\nTo plan: A two/);
    expect(opening).toContain("Attending: sonnet (Programmer) and glm (UI designer)");
    const seated = brief({ seats: { glm: { session: "s", heard: 1 } } });
    expect(meetingHand(seated, glm)).toMatch(/^Said since you last took it in:/);
  });

  it("tell each what was said since they last took the meeting in, not their own words", () => {
    const ctx = brief({
      turns: [
        turn("sonnet", "What engine?", "opening"),
        turn("glm", "Canvas.", "round"),
        turn("sonnet", "Agreed.", "steer"),
      ],
      seats: { glm: { session: "s", heard: 1 } },
    });
    expect(meetingAnswer(ctx, glm, "Colors")).toContain(
      "Said since you last took it in:\n[sonnet] Agreed.\n\nYou have the floor, for what you raised your hand about: Colors.",
    );
  });

  it("give the host the hands up, the floor each has had and what is left", () => {
    const ctx = brief({
      turns: [
        turn("sonnet", "?", "opening"),
        turn("glm", "x", "round"),
        turn("glm", "y", "answer"),
      ],
      hands: [{ member: "glm", point: "Use canvas", to: "sonnet" }],
    });
    const steer = meetingSteer(ctx, 1);
    expect(steer).toContain("Hands up:\n- glm (to sonnet): Use canvas");
    expect(steer).toContain("Times each has had the floor in the discussion: glm 1.");
    expect(steer).toContain("You can give the floor 1 more time at most.");
  });

  it("have the host write the plan for the attendees", () => {
    expect(meetingClosing(brief())).toContain('whose name goes in assignee: "sonnet" and "glm"');
  });
});

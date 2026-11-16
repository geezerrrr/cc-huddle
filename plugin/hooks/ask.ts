/**
 * A need put to you in Claude Code's question dialog: what you said there,
 * as the `answer` tool takes it, or for a plan as `review_plan` does. One
 * dismissed waits in the pane.
 */
import type { EngineInterface } from "claude-code";
import type { HuddleAnswer, HuddleNeed, HuddlePlanDecision } from "../types";
import { readTeam } from "./state";
import { clip, taskPlaces } from "./text";

/** A question dialog's chip holds this many characters. */
const ASK_HEADER = 12;
/** A question dialog has this many options at most. */
const ASK_OPTIONS = 4;

/** How much of what a need says beyond its headline the dialog shows: a task's deliveries, a review's notes. */
const ASK_DETAIL = 2000;

/** A plan out for review, as a need. */
export type PlanNeed = Extract<HuddleNeed, { kind: "plan" }>;

const APPROVE = "Approve";
const APPROVE_PICKING = "Approve, I'll accept some";
const DROP = "Drop";

/**
 * A plan out for review, decided in the dialog: approved, with the tasks you
 * accept picked in a second question when you choose to; dropped; or what
 * you typed instead, the change you want.
 */
async function decidedPlan($: EngineInterface, need: PlanNeed): Promise<HuddlePlanDecision> {
  const said = await $.ui.ask(
    `${need.headline}\n${need.detail ?? ""}\nIts document is in full in /huddle, under Needs you. Type what to change instead, if anything.`,
    { options: [APPROVE, APPROVE_PICKING, DROP], header: need.from.slice(0, ASK_HEADER) },
  );
  if (said === APPROVE) return { decision: "approve" };
  if (said === DROP) return { decision: "drop" };
  if (said !== APPROVE_PICKING) return { decision: "change", change: said };
  const { tasks } = need;
  const numbered = tasks.map((title, i) => `${String(i + 1)}: ${title}`);
  const picked =
    tasks.length <= ASK_OPTIONS
      ? await $.ui.ask("Which tasks do you accept yourself once they are done?", {
          options: numbered,
          header: "Accept",
          multiSelect: true,
        })
      : await $.ui.ask(
          `Which tasks do you accept yourself once they are done? Type their numbers (1, 3).\n${numbered.join("\n")}`,
          { options: ["None", "All"], header: "Accept" },
        );
  const accept =
    picked === "All"
      ? tasks.map((_, i) => i)
      : picked === "None"
        ? []
        : taskPlaces(picked, tasks.length);
  return { decision: "approve", accept };
}

/** A member's question with what each option means, where they said. */
const questionOf = (question: string, options: { label: string; description?: string }[]) =>
  [
    question,
    ...options.flatMap((o) => (o.description ? [`- ${o.label}: ${clip(o.description)}`] : [])),
  ].join("\n");

/**
 * Puts a need to you in the question dialog, and gives the answer for what
 * you said; undefined when what you typed answers nothing. Rejects when you
 * dismiss it.
 */
async function askedAnswer(
  $: EngineInterface,
  need: Exclude<HuddleNeed, { kind: "plan" }>,
): Promise<HuddleAnswer | undefined> {
  if (need.kind === "choices") {
    const picks: string[] = [];
    for (const choice of need.choices)
      picks.push(
        await $.ui.ask(questionOf(`${need.headline} ${choice.question}`, choice.options), {
          options: choice.options.map((o) => o.label),
          header: (choice.header || need.from).slice(0, ASK_HEADER),
          ...(choice.multiSelect && { multiSelect: true as const }),
        }),
      );
    return { kind: "choices", picks };
  }
  const said = await $.ui.ask(
    need.detail ? `${need.headline}\n${clip(need.detail, ASK_DETAIL)}` : need.headline,
    { options: need.options.map((o) => o.label), header: need.from.slice(0, ASK_HEADER) },
  );
  const option = need.options.find((o) => o.label === said);
  if (option) return { kind: "option", option: option.value };
  // What you type instead goes with the option a note goes with, where there is one.
  return need.note && { kind: "option", option: need.note.option, note: said };
}

/**
 * Asks a need that is still open, and answers it as you said: a plan with
 * `decide`, anything else with `answer`. Dismissed, or with nobody to ask (a
 * -p run), as the dialog rejects, it waits in "Needs you".
 */
export async function askNeed(
  $: EngineInterface,
  need: HuddleNeed,
  answer: (given: HuddleAnswer) => Promise<void>,
  decide: (plan: PlanNeed, decided: HuddlePlanDecision) => Promise<void>,
) {
  // Answered meanwhile, in the pane, or a plan changed since: nothing left to ask.
  if (!(await readTeam($))?.needs.some((n) => n.id === need.id)) return;
  if (need.kind === "plan") {
    const decided = await decidedPlan($, need).catch(() => undefined);
    if (decided) await decide(need, decided);
    return;
  }
  let given;
  try {
    given = await askedAnswer($, need);
  } catch {
    return;
  }
  if (given) await answer(given);
  else $.ui.toast("cc-huddle: what you typed answers none of it; it waits in Needs you");
}

/**
 * A need put to you in Claude Code's question dialog: what you said there,
 * as the `answer` tool takes it. One dismissed waits in the pane.
 */
import type { EngineInterface } from "claude-code";
import type { OpenplanAnswer, OpenplanNeed } from "../types";
import { readTeam } from "./state";
import { clip } from "./text";

/** A question dialog's chip holds this many characters. */
const ASK_HEADER = 12;

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
  need: OpenplanNeed,
): Promise<OpenplanAnswer | undefined> {
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
    need.detail ? `${need.headline}\n${clip(need.detail)}` : need.headline,
    { options: need.options.map((o) => o.label), header: need.from.slice(0, ASK_HEADER) },
  );
  const option = need.options.find((o) => o.label === said);
  if (option) return { kind: "option", option: option.value };
  // What you type instead goes with the option a note goes with, where there is one.
  return need.note && { kind: "option", option: need.note.option, note: said };
}

/** Asks a need that is still open, and answers it (`answer`) as you said; dismissed, it waits in the pane. */
export async function askNeed(
  $: EngineInterface,
  need: OpenplanNeed,
  answer: (given: OpenplanAnswer) => Promise<void>,
) {
  const team = await readTeam($);
  // Answered meanwhile, in the pane: nothing left to ask.
  if (!team?.needs.some((n) => n.id === need.id)) return;
  let given;
  try {
    given = await askedAnswer($, need);
  } catch {
    // Dismissed, or nobody to ask (a -p run), as the dialog rejects: it waits in "Needs you".
    return;
  }
  if (given) await answer(given);
  else $.ui.toast(team.typedAnswersNone);
}

/**
 * How your task is best taken on, before its goal starts (docs/design.md
 * §7.1): the team together or one member solo, and who. Judged in a
 * read-only session of its own, told only the team and the task.
 */
import { z } from "zod";
import { recommendSettings } from "../shared/layout.ts";
import type { Team } from "./core.ts";
import { guarded, recommendOptions, writeSettings } from "./policy.ts";
import { recommendPrompt } from "./prompts.ts";
import { askOnce } from "./turns.ts";

// One object, not a union of two: structured output takes an object at the top.
const recommendationSchema = (names: [string, ...string[]]) =>
  z.object({
    way: z.enum(["together", "solo"]),
    members: z
      .array(z.enum(names))
      .min(1)
      .describe("Together: who takes part, the host first. Solo: the one member."),
    why: z.string(),
  });

export type Recommendation = z.infer<ReturnType<typeof recommendationSchema>>;

/** Where and with what a recommending session runs. */
export interface Recommending {
  /** The repository's folder in the data folder, where its settings file is written. */
  folder: string;
  /** The repository's top folder, where it looks. */
  cwd: string;
  /** The Claude Code it runs. */
  claude: string;
  /** cc-huddle's ids as `enabledPlugins` names them, turned off in it. */
  plugins: readonly string[];
  env: Record<string, string | undefined>;
  signal: AbortSignal;
}

/** Recommends how `task`, in your words, is best taken on by `team`; throws why it couldn't. */
export async function recommend(
  task: string,
  team: Team,
  at: Recommending,
): Promise<Recommendation> {
  const names = team.members.map((m) => m.name) as [string, ...string[]];
  const settings = recommendSettings(at.folder);
  await writeSettings(settings, guarded({}, at.plugins));
  const schema = recommendationSchema(names);
  const reply = await askOnce({
    prompt: recommendPrompt(task, team.members),
    options: recommendOptions(at.claude, at.cwd, settings, at.env),
    schema,
    signal: at.signal,
    // Before a goal there is nobody to count them to.
    spent: () => undefined,
  });
  return schema.parse(reply.structured);
}

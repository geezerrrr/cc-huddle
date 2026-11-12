/**
 * Waking your session (docs/design.md §7.3) for what needs a conversation: a
 * plan to review, and a task to accept. A message posted to the session's
 * inbox socket starts a turn in it once it is idle; everything else waits in
 * the pane.
 */
import { connect } from "node:net";
import { YOU, type TeamState } from "../engine/types.ts";

/**
 * Posts `text` to your session's inbox, as Claude Code's own sessions post
 * to each other. Without a socket (`claude -p`), there is no one to wake.
 */
export function wakeSession(text: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const socket = env.CLAUDE_CODE_MESSAGING_SOCKET;
  const token = env.CLAUDE_CODE_MESSAGING_TOKEN;
  if (!socket) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const lines = [
      ...(token ? [{ type: "auth", token }] : []),
      { type: "user", message: { role: "user", content: text } },
    ];
    const posting = connect(socket, () => {
      posting.end(lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
    });
    posting.on("error", reject).on("close", () => {
      resolve();
    });
    // The session may answer on the socket; nothing it says is needed.
    posting.resume();
  });
}

/**
 * What needs a conversation that wasn't there before: each plan that came
 * out for review and each task done, told once. What waits already when the
 * team opens is the SessionStart hook's to tell.
 */
export class NewForYou {
  private readonly told = new Set<string>();

  constructor(state: TeamState) {
    this.news(state);
  }

  /** The messages for what is new in `state`. */
  news(state: TeamState): string[] {
    const messages: string[] = [];
    const fresh = (id: string) => {
      if (this.told.has(id)) return false;
      this.told.add(id);
      return true;
    };
    for (const meeting of state.meetings)
      if (meeting.status === "review" && meeting.plan && fresh(meeting.id))
        messages.push(
          `openplan: the meeting [${meeting.id}] on "${meeting.agenda}" has a plan: ${meeting.plan.summary}. Show it to the user with show_plan, and ask whether to approve it, change it, or cancel it.`,
        );
    for (const question of state.questions) {
      if (
        question.to !== YOU ||
        question.status !== "open" ||
        question.decision?.kind !== "delivery" ||
        !fresh(question.id)
      )
        continue;
      const subtask = state.subtasks.find((s) => s.id === question.subtaskId);
      const delivered = state.subtasks
        .filter((s) => s.taskId === subtask?.taskId && s.delivery)
        .map((s) => `- ${s.title}, by ${s.assignee}: ${s.delivery?.summary ?? ""}`);
      messages.push(
        [
          `openplan: the task "${question.text}" is done [${question.id}], merged into its goal's branch:`,
          ...delivered,
          "Tell the user what was done, and ask whether to accept it or send it back with what to change (decide).",
        ].join("\n"),
      );
    }
    return messages;
  }
}

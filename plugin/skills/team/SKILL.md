---
name: team
user-invocable: false
description: Run the repository's openplan team, members who are Claude Code sessions of their own. Use when the user hands the team a task (`/openplan <task>`), asks the team or a member to do something (build, plan, hold a meeting, take over a piece of work), passes a member a message, decides on a plan or a finished task, or asks how the team stands.
---

You run the team for the user: you pass on what they want and what the team hands back. The work is the members'.

- Give work to the team with openplan's tools, never by doing it yourself: a goal (`start_goal`), then a planning meeting (`hold_meeting`), or a subtask for one member (`assign`). Each returns at once; the team works in the background.
- Before work starts, propose who takes it, keeping to anyone the user named: a meeting when it needs planning among several members (who attends, the host first, and what each brings to it), or one member when it doesn't (what they will do). Ask the user with `AskUserQuestion` to start with that or say what to change, and propose again until they start.
- One goal runs at a time. When starting or resuming one is refused because another is under way, tell the user which one, and ask with `AskUserQuestion` whether to pause it first (`goal_action`). Go on only on their word.
- A message to a member (`@glm put the scoreboard top right`) goes to them with `message`, in their session.
- When the team needs a conversation, a message from openplan wakes you:
  - A plan is ready: show it with `show_plan`, then ask the user with `AskUserQuestion` whether to approve it, change it, or cancel the meeting. Changes are said in words: rewrite the plan with them and `change_plan`, then ask again.
  - A task is done: tell the user what was done, and ask whether to accept it or send it back with what to change (`decide`).
- A permission request or a member's question waits for the user in openplan's pane (`/openplan`). Tell them it is there; you can't answer it for them.
- To see where things stand, call `status`. Ids in brackets name goals, meetings, subtasks and questions in the other tools.
- Stopping, retrying or redoing a subtask, and pausing, archiving or deleting a goal, are the user's calls: do them when they ask.

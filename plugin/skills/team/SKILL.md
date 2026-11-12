---
name: team
user-invocable: false
description: Run the repository's openplan team, members who are Claude Code sessions of their own. Use when the user asks the team or a member to do something (build, plan, hold a meeting, take over a piece of work), passes a member a message, decides on a plan or a finished task, or asks how the team stands.
---

You run the team for the user: you pass on what they want and what the team hands back. The work is the members'.

- Give work to the team with openplan's tools, never by doing it yourself: a goal (`start_goal`), a planning meeting (`hold_meeting`), or a subtask for one member (`assign`). Each returns at once; the team works in the background.
- A message to a member (`@glm put the scoreboard top right`) goes to them with `message`, in their session.
- When the team needs a conversation, a message from openplan wakes you:
  - A plan is ready: show it with `show_plan`, then ask the user with `AskUserQuestion` whether to approve it, change it, or cancel the meeting. Changes are said in words: rewrite the plan with them and `change_plan`, then ask again.
  - A task is done: tell the user what was done, and ask whether to accept it or send it back with what to change (`decide`).
- A permission request or a member's question waits for the user in openplan's pane (`/openplan`). Tell them it is there; you can't answer it for them.
- To see where things stand, call `status`. Ids in brackets name goals, meetings, subtasks and questions in the other tools.
- Stopping, retrying or redoing a subtask, and pausing, archiving or deleting a goal, are the user's calls: do them when they ask.

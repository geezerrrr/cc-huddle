---
name: team
user-invocable: false
description: Run the repository's cc-huddle team, members who are Claude Code sessions of their own. Use when the user hands the team a task (`/huddle <task>`), asks the team or a member to do something (build, plan, hold a meeting, take over a piece of work), decides on a plan or a finished task, or asks how the team stands.
---

You run the team for the user: you pass on what they want and what the team hands back. The work is the members'.

- A task for the team is a goal of its own (`start_goal`), planned once as it starts: a meeting (`hold_meeting`), or, with one member, the task assigned to them (`assign`). Each returns at once; the team works in the background. Nothing is added to a goal after: what the user wants next, a change to finished work included, is the next goal.
- Before it starts, look at the repository as much as you need to know what the task asks for. Then propose who takes part, by what the work needs: the members whose angle it needs, anyone the user named among them, the host first. Don't judge how the work divides; the plan does.
- Ask the user with `AskUserQuestion`: start with them, or say what to change. Propose again until they start. With one member picked, start the goal and assign them the task; with several, start it and hold their meeting. Put what you found in the meeting's agenda or the task's description.
- This session runs one goal, and the tools are all about it. Starting another is refused while it is under way: tell the user to pause it first (`/huddle pause`) or to use another session. Don't ask.
- The user takes up another of the repository's goals with `/huddle resume`; you can't.
- cc-huddle asks the user itself, in Claude Code's question dialog, whatever the team needs from them: a plan to approve, a finished task to accept, the finished goal to merge back into their branch, a permission, a member's question. One they dismiss waits in cc-huddle's pane (`/huddle`). Don't ask them these yourself, and don't answer for them; when they tell you a decision in words, carry it out (`approve_plan`, `cancel_meeting`, `decide`).
- When the user types a change to a plan, a message from cc-huddle gives it to you: get the plan with `show_plan`, rewrite it with their words and `change_plan`, keeping the tasks they accept as they are unless they say. cc-huddle then asks them about the changed plan.
- To see where things stand, call `status`. Ids in brackets name meetings, subtasks and questions in the other tools.
- Stopping, going on with or retrying a subtask, and pausing, archiving or deleting a goal, are the user's calls: do them when they ask.

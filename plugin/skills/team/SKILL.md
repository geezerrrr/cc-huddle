---
name: team
user-invocable: false
description: Run the repository's cc-huddle team, members who are Claude Code sessions of their own. Use when the user hands the team a task (`/huddle <task>`), asks the team or a member to do something (build, plan, hold a meeting, take over a piece of work), passes a member a message, decides on a plan or a finished task, or asks how the team stands.
---

You run the team for the user: you pass on what they want and what the team hands back. The work is the members'.

- Give work to the team with cc-huddle's tools, never by doing it yourself: a goal (`start_goal`), then a planning meeting (`hold_meeting`), or a subtask for one member (`assign`). Each returns at once; the team works in the background.
- Before work starts, look at the repository as much as you need to know what the task changes. Then recommend whichever would get it done better: one member doing all of it, one part after another, or a meeting where several members plan it and each does a part at the same time, at the cost of the meeting and of putting their parts together. Keep to anyone the user named, and say what your recommendation rests on.
- Ask the user with `AskUserQuestion`: what you recommend first, the other second, each saying who does what (for a meeting, who attends, the host first). Propose again until they start. Put what you found in the meeting's agenda or the subtask's description.
- This session runs one goal, and the tools are all about it. A new task while it has one: ask with `AskUserQuestion` whether the task is part of it (a meeting or work in it), or a goal of its own. Starting one is refused while this session's goal is under way: ask whether to pause it first (`goal_action`), or to run the new goal in another session. Go on only on their word.
- The user takes up another of the repository's goals with `/huddle resume`; you can't.
- A message to a member (`@glm put the scoreboard top right`) goes with `message` to the subtask of theirs it is about: the one they work on, unless the user means another (`status` has the ids). It reaches them in that subtask's session.
- cc-huddle asks the user itself, in Claude Code's question dialog, whatever the team needs from them: a plan to approve, a finished task to accept, a permission, a member's question. One they dismiss waits in cc-huddle's pane (`/huddle`). Don't ask them these yourself, and don't answer for them; when they tell you a decision in words, carry it out (`approve_plan`, `cancel_meeting`, `decide`).
- When the user types a change to a plan, a message from cc-huddle gives it to you: get the plan with `show_plan`, rewrite it with their words and `change_plan`, keeping the tasks they accept as they are unless they say. cc-huddle then asks them about the changed plan.
- To see where things stand, call `status`. Ids in brackets name meetings, subtasks and questions in the other tools.
- Stopping, retrying or redoing a subtask, and pausing, archiving or deleting a goal, are the user's calls: do them when they ask.

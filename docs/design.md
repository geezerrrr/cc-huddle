# openplan design

This document is the source of truth for how openplan behaves. Change it first, then the code; code that disagrees with it is a bug.

## 1. What it is

openplan is a Claude Code plugin that runs a team of Claude Code sessions on your repository. Each member has a role and its own model, which can come from any provider with an Anthropic-compatible API. A goal starts with a meeting where the members compare approaches and the host writes a plan of tasks with owners, dependencies and acceptance criteria. You approve the plan, and the members work in parallel, each subtask in its own git worktree. Their deliveries are reviewed, sent back when they fail, and merged into the goal's branch. You are asked only when something needs you.

What makes it different is where the rules live. Agent Teams and prompt-driven orchestrators ask a lead model to follow a process. openplan keeps the process in state machines in code: the models decide what to write, never which step comes next. Workers are driven through the Agent SDK, so the engine sees every tool call, permission request, question and result as a structured event and never guesses a terminal's state.

openplan comes out of [Crewloft](https://playcrewloft.com), a game in which the same engine runs a studio of AI staff.

### Not in scope

- A user interface of its own. Everything you see is drawn inside Claude Code (§7).
- Single focused jobs. A subagent is cheaper and quicker for one search, one review or one module; openplan is for work with several people, steps and dependencies.
- Pushing, opening pull requests, or touching your checkout. The team works on its own branches; merging them is yours.

## 2. Concepts

| Concept       | What it is                                                                                                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role          | A job and its duties, e.g. `gameplay-programmer`. A file in the team folder.                                                                                                    |
| Member        | Someone on the team: a name, a role, a provider, a model and an effort. A file in the team folder.                                                                              |
| Goal          | What you want done, run by one session (§3.2): its own branch `openplan/<goal>/main` cut from your `HEAD` as it starts, its own copy of the team as it was then, its own state. |
| Meeting       | A read-only discussion among chosen members that ends in a plan for a goal.                                                                                                     |
| Plan          | The host's document plus a tree: tasks, their subtasks, an owner, dependencies and acceptance criteria for each.                                                                |
| Task, subtask | A task is one result for you, its subtasks done; a subtask is one member's piece of work, done in one worktree. You accept a task yourself only where you chose to.             |
| Question      | Anything that waits on someone: a member asking a teammate or you, a permission request, a decision on a stuck review or merge, a finished task you chose to accept.            |
| Your session  | The Claude Code session you talk in. It relays what you want and acts on it through tools. It never does the team's work.                                                       |

A member is busy while a subtask of theirs runs or waits on its review, while they review a delivery, or while they sit in a meeting. A busy member starts nothing new. Everyone does one thing at a time in a goal; two goals run by two sessions each have their own copy of the member, each in Claude Code processes of its own.

## 3. Architecture

Two layers. The engine knows nothing of the plugin.

```
┌─────────────────── Claude Code (your session) ───────────────────┐
│  mod: asks, pane, band, /openplan            skill               │
│        │ socket: view    $.mcp.call: pane, answer                 │
│  MCP server `openplan`: tools ── engine: state machines ·         │
│                                  scheduler · meetings · questions │
│                                  · worktrees and merges           │
└────────────────────────────────┬──────────────────────────────────┘
                                 │ one Claude Code process per running turn
                 member sessions (Agent SDK), each in its worktree
```

### 3.1 Engine

A library with no knowledge of Claude Code's interface. It holds:

- **State machines** (§4): the only place a status changes.
- **Derivations**: what each subtask waits on, who is busy, who reviews, what you can do to each thing. Worked out from state every time, never stored.
- **Scheduler**: starts every pending subtask whose upstream is merged and whose owner is free.
- **Meetings**: turns, raised hands, the floor, the host's plan.
- **Questions**: one inbox for everything that waits on a person.
- **Git**: worktrees, delivery commits, serialized merges, conflict handling (§5).
- **Turns**: one Agent SDK query per turn, one decoder for its message stream, one place that judges success.
- **Policy**: the options of every session: tools, permission rules, sandbox, environment.
- **Prompts**: every prompt the engine sends, in one module.

It is ported from Crewloft's engine without the game: no economy, life, seats, account or layout.

### 3.2 Lifetime

A goal belongs to the session it runs in, like everything else that session starts. The engine runs inside the session's MCP server, which Claude Code starts with the session and ends with it, and the member processes are its children. There is no process of openplan's own outside a session. Members run the Claude Code your session runs, found as the MCP server's parent process, so they share its version and install, and openplan ships no Claude Code of its own. A member never outlives the MCP server either: an orphaned Claude Code process goes on with its turn, calling the model, until the turn ends. The MCP server stops its members when the session ends and when it exits for any reason it can catch, a crash included. Each member's pid is recorded in the goal's folder with its settings file, so a start after a server that was killed outright stops what it left, once the process's command line shows that file.

Closing the session pauses its goal, as if you had paused it (§4.1): running subtasks are held in their sessions (a merge under way finishes first), a running meeting is cancelled, open questions stay open, sessions and worktrees are kept. Resuming the session brings back its context; nothing starts again until you take the goal up again (`/openplan resume`). A session killed outright couldn't pause its goal: the next one to take the goal up pauses it first. To keep the team working while you are away, keep the session running, in the background if you like, the way Claude Code already offers.

`/clear` only clears the conversation: the goal keeps working, and the new conversation learns where it stands from the SessionStart hook and the tools.

A session runs one goal, and a goal runs in one session. To run several goals at once, run several sessions, as with Claude Code itself: each goal has its own folder and its own copy of the team, so goals don't touch each other's files, and where their work meets in your repository, merging it settles it, as it does for any two sessions. A session starts a goal (`start_goal`), or takes one up with `/openplan resume`, which lists the repository's goals that aren't running here, each by name and how far it got, and whether it is paused, archived or running in another session; you pick one. Taking up a goal another session runs is a hand-over: that session pauses it, lets it go, and says what it stopped; this one opens it and resumes that, so members go on in their sessions and worktrees, now as this one's children, and the session that let it go shows that it moved. A session whose goal is active pauses it only on your word before starting another or taking one up; one whose goal is paused or archived lets it go as it does.

Claude Code doesn't keep a conversation in one process: the Agent view (`←` on an empty prompt) moves it to a process of its own, with a session id of its own and nothing that names the one before, and processes started ahead of need run their MCP servers and hooks with no conversation yet. So a goal doesn't follow its conversation by itself: in the new process, take it up with `/openplan resume`, where it is listed as running in another session. The MCP server opens a goal only when its session starts or takes one up, never as it starts.

Each goal is held by a lock in its folder with the pids of the MCP server and its session and where the server is asked to let the goal go (its pane socket, §3.3). The lock is put in place whole, so of sessions taking a goal at once one gets it. A lock whose holder has ended is replaced by the one taker that claims that ending (a file named for the ended pid), and only while it is still that holder's, so a lock taken meanwhile is never replaced. Whatever openplan puts in place whole (the lock, the goal's state, the server's dependencies) it writes beside and renames over; on Windows, where an antivirus or an indexer holding a new file or folder a moment refuses the rename, it tries again for a few seconds, as npm does.

### 3.3 Plugin

- **MCP server `openplan`**: the engine of your session's goal and the tools your session uses (§7.3). The pane reads the team twice a second from the server's own socket: `POST /view` gives the team as the pane draws it and a member's record from where it left off. It doesn't go through `$.mcp.call`, which Claude Code runs as a tool call, with your PreToolUse and PostToolUse hooks around it each time. The socket is one per session, in a folder only you can read (a named pipe on Windows), and does only one thing besides reading: `POST /release` lets the goal go to another of your sessions that takes it up (§3.2). More tools serve the mod: `pane` names the socket, once, `answer` carries what you pressed, `resume_goal` carries `/openplan resume`, and `hand_off` makes the prompt `/openplan <task>` gives your session. The mod keeps them from your session's model, so an answer comes only from you. `/openplan pause` is your session's `goal_action`.
- **Mod**: the asks, the pane, the band, transcript rows and the `/openplan` command (§7.2), and the prompts that wake your session (§7.3). `/openplan <task>` hands your session the task for the team; the pane and `status` run without a model turn. The mod only draws and passes on what you press: every word it shows about the team, what each need offers and takes, and when it refuses, are the server's (`src/plugin/words.ts` says each thing once, for the pane and for your session alike); its own words are only its controls' and the `/openplan resume` dialog's.
- **Skill**: tells your session what it is for: relay and act, never do the work itself.
- **SessionStart hook**: tells your session, as context, which of the repository's goals are paused and which run in other sessions, and how to take one up. The mod shows the same in the band.
- **Permission mode hook**: keeps your session's permission mode for its members (§8). Claude Code gives `permission_mode` to the `UserPromptSubmit` hook, and to `PreToolUse`, here only on openplan's own tools; the hook writes it to the data folder under the session's pid, where the MCP server of that session reads it. A file whose session has ended goes as the next one is written.

The repository's `plugin/` folder is the plugin, listed by the marketplace at the repository's top, so it installs with `/plugin install`. The MCP server and the hook are bundled into `plugin/dist/`, committed so an install needs no build. The Agent SDK isn't openplan's to ship: the server's npm dependencies are installed into the data folder the first time a version starts, with `npm ci` from `dist/package.json` and the `dist/package-lock.json` beside it, so every install gets the same tree, without the optional platform binaries, since members run your session's Claude Code.

### 3.4 Where things live

| What                                                                              | Where                                                                                   | In git                            |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------- |
| Team: roles, members, settings                                                    | `~/.claude/openplan/`, and `.claude/openplan/` in the repository                        | The repository's, yours to commit |
| A goal: its copy of the team, its state, lock, plans, records and member settings | `${CLAUDE_PLUGIN_DATA}/repos/<repo-id>/goals/<goal>/`                                   | No                                |
| Worktrees                                                                         | `goals/<goal>/checkout/` for the goal, `goals/<goal>/desks/<subtask>/` for each subtask | Branches only                     |
| The MCP server's npm dependencies                                                 | `${CLAUDE_PLUGIN_DATA}/deps/<version-hash>/`                                            | No                                |

`${CLAUDE_PLUGIN_DATA}` is the data folder Claude Code gives each plugin (`~/.claude/plugins/data/<plugin-id>/`). openplan makes it a folder only you can read: goals' state, records and team copies hold what members said, did and were given. It is passed to the MCP server and the hooks. It survives plugin updates and is removed on uninstall, worktrees included; their branches stay in your repository, and git prunes the stale worktree entries on its own. `claude plugin uninstall --keep-data` keeps it.

Worktrees sit outside the repository on purpose: inside it, every member session would also load the main checkout's `CLAUDE.md` files as parent folders. Keys never go in any of these (§6).

## 4. State machines

Each machine is one table in code (`src/engine/machines.ts`), moved only by its owner module through `step`. A move the table lacks is refused. Waiting is never a status: why something waits is derived (§4.5).

### 4.1 Goal

| From             | Event              | To       |
| ---------------- | ------------------ | -------- |
| —                | start              | active   |
| active           | pause              | paused   |
| active, paused   | archive            | archived |
| paused, archived | resume             | active   |
| archived         | delete (confirmed) | removed  |

Pausing holds its running subtasks in their sessions and cancels its running meeting. Deleting removes its folder, its worktrees and its subtask branches; its branch `openplan/<goal>/main` stays.

A session runs one goal (§3.2), so its band, its pane and what wakes it are about that goal alone.

### 4.2 Meeting

| From              | Event                                      | To                             |
| ----------------- | ------------------------------------------ | ------------------------------ |
| —                 | start: goal active, every participant free | running                        |
| running           | the host's plan parses                     | review                         |
| running           | error                                      | failed                         |
| running           | you cancel, goal paused or archived        | cancelled                      |
| review            | you change the plan                        | review                         |
| review            | you approve                                | approved                       |
| review            | you cancel, goal archived                  | dropped                        |
| failed, cancelled | you go on                                  | running, from where it stopped |

The flow is Crewloft's (its `team.md` §4): the host opens with the questions to settle; every member gives a first judgment, all at once and without hearing each other; members raise a hand to speak; the host gives the floor, closes when every question is settled or the size's turn budget is spent, and writes the plan. Sizes (`small`, `discussion`, `large`) set only how many turns each member gets. Meeting sessions are read-only.

A meeting is for lining up, not for working out details. It settles the direction (what to make and the few choices that shape it), who does which piece, and which interfaces there are between the pieces (names, conventions or formats one piece defines and another uses) and who defines each. What an interface holds and how a piece is built are worked out afterwards by whoever does it; whoever needs it asks them (`ask_teammate`). Every turn keeps to that: the opening, the first judgments, what the host asks of whom, a hand worth the floor. A turn says only what hasn't been said, its conclusion and its reason.

- **The host.** You name who attends, and the first named hosts; with nobody named, everyone attends and the first member by name hosts. A host takes part as well, by default: they give a first judgment like everyone, answer for their own piece in the talk, have their view weighed like anyone's, and get work in the plan. A host who only runs it (`hostOnly`) gives no judgment, takes no side and gets no work; it takes someone else to run it for. The members are everyone attending but a host who only runs it; the first judgments and the plan's assignees are theirs.
- **The floor.** The host gives it to one member with `give_floor`, saying what they need from them, or gives it to nobody, which closes the talk, hands up or not. A hand about what an interface holds or how a piece is built isn't worth the floor. With no hand worth it, the host checks what they set out to decide one thing at a time against what was said (nobody objecting isn't it), then puts the split to the room once (the pieces, who takes each, the interfaces and who defines each) before closing. What the host says before handing over the floor is said to the room, as what follows is.
- **The plan.** Subtasks follow what each piece needs from another: a subtask depends only on those whose results it uses. An interface others wait on is defined first, in a quick subtask of its own by whoever defines it; putting the pieces together and checking the whole is a subtask at the end. Beyond that, one member's piece is one subtask, since each subtask carries a fixed cost (a new session getting to know the repository, a review, a merge). No task comes for you to accept: which ones you accept yourself is yours to tick in review (§7.1).

A meeting that stopped before its plan (failed, cancelled) can go on; one whose plan you dropped can't. Who speaks, whether the plan is being written, the first judgments being formed, who speaks next being weighed, and the hands up are what is under way: the meeting's owner keeps them while it runs, and they aren't in the state.

Each attendee keeps one session for the whole meeting, in the goal's worktree. An approved plan's document is saved in the goal's folder, and the first run of each of its subtasks gets it in its brief, since members work in their worktrees and not in the data folder.

### 4.3 Subtask

| From                                                 | Event                                                           | To                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| —                                                    | plan approved, or assigned directly                             | pending                                                 |
| pending                                              | upstream merged, owner free, goal active                        | running                                                 |
| pending, running                                     | you stop it                                                     | stopped                                                 |
| reviewing                                            | you stop it                                                     | stopped in review                                       |
| merging (waiting on you)                             | you stop it                                                     | stopped in merge                                        |
| running                                              | delivered, review on                                            | reviewing                                               |
| running                                              | delivered, review off                                           | merging                                                 |
| running                                              | error, or no delivery after one reminder                        | failed                                                  |
| running                                              | goal paused, you add to it                                      | pending, same session                                   |
| reviewing                                            | passed, or you skip the review                                  | merging                                                 |
| reviewing                                            | sent back (first two times)                                     | pending, same session, with the notes                   |
| merging                                              | merged                                                          | done                                                    |
| merging                                              | text conflicts                                                  | pending, same session, to resolve them                  |
| failed, stopped, stopped in review, stopped in merge | retry                                                           | pending, fresh session and worktree                     |
| failed, stopped                                      | go on                                                           | pending, same session and worktree                      |
| stopped in review                                    | go on                                                           | reviewing, its delivery standing                        |
| stopped in merge                                     | go on                                                           | merging, its delivery standing                          |
| done                                                 | redo: upstream redone, you add to it, or you send its task back | pending, same session, worktree rebuilt from the branch |

Your actions (stop, go on, retry, redo) are each one or more events: an action is offered where one of its events can happen, and does that one.

A third failed review, a review that errors, a binary conflict and a git error each become a decision for you (§4.4) rather than a move.

A running subtask's member has two tools beyond Claude Code's own, from an in-process MCP server given to its turn: `ask_teammate`, a question a teammate answers in a read-only session, and `deliver`, a summary and the files that are the result. A run is done only once it delivers. The Team tab follows its steps from its own `TodoWrite` calls.

### 4.4 Question

A question has no status: it is in the state while it is open, and leaves it once answered, or called off when the asker stops waiting.

Kinds: a teammate's question (answered by that teammate in a read-only session), a question to you (Claude Code's own `AskUserQuestion`, intercepted), a permission request, a decision (stuck review, binary conflict, git error), and a finished task you chose to accept.

### 4.5 Derived, never stored

- What a subtask waits on: an upstream subtask, a busy owner or reviewer, a merge ahead of it, a paused goal, a teammate's or your answer. Upstream work in a task you accept yourself is waited on as that whole task, done and accepted; in any other task, only the subtasks depended on, merged. A reviewer reviews one delivery at a time and the goal merges one at a time: the one under way first, then the rest in delivery order. What is under way isn't in the state (after a restart nothing is); the scheduler says, and the rules read it with the state. The scheduler starts exactly what these rules leave waiting on nothing.
- A member's work that goes on in its session (held, sent back, conflicts, redone) goes before new work of theirs: new work that could start waits for it while it can start too.
- Who is busy, who reviews a delivery (the meeting's host, else another member), whose upstream was redone after it started, and whether a task you accept is accepted: done, with no acceptance waiting on you.
- What you can do to each subtask, meeting and goal: asked of the same tables with `can`. The scheduler refuses anything else you ask of a subtask, saying why.

## 5. Git

- A goal's branch `openplan/<goal>/main` is cut from your `HEAD` when it starts and checked out in the goal's own worktree in the data folder. Meetings and reviews read the goal there, and merges land there. While the goal has that worktree, git keeps the branch from being checked out anywhere else, so nothing moves under a checkout of yours; diff it, merge it, or open the goal's folder. If the name is taken (any branch under `openplan/<goal>/`, from a deleted goal or another clone), the goal takes `<goal>-2` and so on.
- Each subtask works in its own worktree on branch `openplan/<goal>/<subtask>` (a goal's branches share one folder of refs, since git can't hold both `openplan/<goal>` and `openplan/<goal>/<subtask>`), cut from the goal branch when it first starts, kept through send-backs, conflicts and pauses, removed when merged.
- Delivering commits what is uncommitted in the worktree as the member (`<name> <member-id>@openplan.local`). Members needn't commit, and are told so; one that does, where its permissions let it, commits under its own name too, as its environment names it.
- Merges run one at a time per goal, in delivery order: the goal branch is merged into the worktree, then the goal branch fast-forwards to it. Text conflicts go back to the member who delivered last, in their session. Binary and delete/modify conflicts and git errors become your decision.
- Git runs with hooks, fsmonitor and signing off for the engine's own commands. It is the `git` on your `PATH`; members use it as they would anywhere.
- openplan never pushes, never checks out anything in your repository, never runs `worktree prune`, and touches only `openplan/*` branches. The goal branch is yours to merge or review whenever you like.

## 6. Team configuration

```
~/.claude/openplan/          yours, for every repository
.claude/openplan/            the repository's
  roles/gameplay-programmer.md
  members/sonnet.md
  members/glm.md
  settings.json
  team.json
```

The team has the two scopes Claude Code's own setup has, and you write its files yourself. Yours sits beside Claude Code's user settings (in `CLAUDE_CONFIG_DIR` when that is set); the repository's beside the rest of its Claude Code setup. The two are read together: a role or member the repository has by the same name replaces yours, its `team.json` fields replace yours, and the two `settings.json` merge as Claude Code merges its scopes, arrays joined. Most people keep their members in theirs, written once, and give a repository only what is its own. The team is not in `agents/`: Claude Code would load members there as its own subagents, on its own provider.

A role file is its duties in Markdown with a `title` in front matter. A member file names its role, model and effort, and the environment its Claude Code runs with:

```markdown
---
role: ui-designer
model: glm-5.3-flashx
effort: max
env:
  ANTHROPIC_BASE_URL: https://open.bigmodel.cn/api/anthropic
  ANTHROPIC_AUTH_TOKEN: ${GLM_API_KEY}
---
```

The member's name is the file name. `env` is written as in `.mcp.json`: `${VAR}` and `${VAR:-default}` are filled in from the environment openplan runs in, so keys stay out of the files. A member without `env` runs on your own Claude Code sign-in.

`settings.json` is a Claude Code settings file applied to every member: the permission rules they work under, the sandbox, anything else Claude Code settings hold. `team.json` holds openplan's own: acceptance review on or off (on by default) and the default meeting size.

A member session loads your user and project settings like any session of yours. On top, as flag settings, which outrank both: the team's `settings.json`, the member's `env`, and the guards of §8. Your own settings' `env` would otherwise override the member's. The engine writes these to a file only you can read in the goal's folder as the goal opens, and again as you allow a rule always, and passes its path, since settings given inline end up on a command line where other processes can read them.

A goal copies the team into its folder as it starts, as read then: roles, members, settings, `team.json`, each member's `env` still as written, its `${VAR}`s filled in only as the goal opens, so no key is written down. The goal works with that copy to its end: its plan and who does what were made with that team, so a member removed or changed later is still there for it, and goals started after get the team as it is then. A rule you allow always goes in the repository's `settings.json`, for goals started after, and in the goal's copy, for its members' next turns.

## 7. Interaction

### 7.1 A goal, end to end

1. You hand the team a task: `/openplan build a two-player dice game, GLM on the art`, or ask your session in words. The command makes it the team's for certain: the mod gives your session the task, the goal it runs with the team's roster, and the rule not to do it itself; how to take it on is the team skill's.
2. Your session proposes who takes it, keeping to anyone you named: a meeting (who attends, the host first and whether they only run it, what each brings) or one member for work that needs no planning. It asks with `AskUserQuestion`: start, or say what to change; it proposes again until you start. Then it starts the goal and holds the meeting or assigns the work, and returns at once.
3. The meeting runs in the background. You watch it live in the pane.
4. The plan is ready: your session wakes, shows you the plan in full, its document and its tasks with who does what, on what each waits and which you accept, and asks with `AskUserQuestion`: approve, change it, or drop it, and which tasks, if any, you want to accept yourself once done. None is by default: code is checked by its reviewer and its checks, and you would rarely read it line by line; a task is worth your own acceptance when only looking at it or trying it can judge it. Changes are said in words, and your session rewrites the plan with them; any member can be given work, not only those who attended.
5. Members work. Whatever needs you is asked at once in Claude Code's own question dialog, as your session's questions are, and you answer it with a key; one you dismiss waits in the pane's "Needs you" tab.
6. A task is done once its last subtask merges, and the transcript says so. One you chose to accept waits for you instead: your session wakes to ask, and work in other tasks that builds on it waits until you accept it. Either way, to change a done task, pass its member a message (§7.3); work built on it is marked as built on something redone. Work you assign directly is a task you don't accept.

### 7.2 What you see

- **Pane** (`/openplan`), beside the transcript in a wide fullscreen terminal, above the prompt otherwise. It opens with the keyboard, so Tab and Enter work in it at once; Esc gives the keys back to the prompt. Three tabs, on keys 1, 2 and 3, and the keys that work on its last line, as Claude Code's own dialogs give theirs. What keeps coming, the meeting and a member's record, shows from its end and keeps up as it grows, the way the transcript does: scrolling up lets it go, scrolling back to the end keeps it again.
  - **Meeting**: the discussion word by word, who speaks, raised hands, whom the host calls. The turn being spoken shows what the speaker thinks and looks up as it goes, drawn as a record is; once said, only its words stay. The first judgments are formed all at once, so they don't stream: the pane says the members are forming them, and each shows once given.
  - **Team**: one line per member: what they do, which step, whom they wait on, and the tokens their own sessions have used: their runs, the reviews they did, their answers to teammates and their meeting turns, each counted to whoever used them. Selecting a member at work shows their record live in the team's place, as Claude Code shows a teammate's transcript in place of the conversation; the pane's title names them, and Back (b) shows the team again. A record is drawn as a transcript is, plainly: words as Markdown, thinking in one line, each tool call with its main argument and the first lines of what it gave, and what the Agent SDK reports along the way (a retry, a compaction, a fallback model, a rate limit) in a dim line of words.
  - **Needs you**: each open question with its options as buttons: the ones dismissed from their ask, and every one while it waits. Pressing one answers it. A member's question shows each option with what it means, as they gave it, and takes an answer typed instead, as the dialog's Other does; one that takes several picks takes them typed. Nothing goes through a model, so a permission is granted only by you.
- **Band** above the prompt, plain text that takes no keys, about your session's goal: `openplan · meeting · 3 working · 1 needs you`, and under it a line for each task not yet done: its title and where it stands (`Rules · bob works on it`, `Board · waits on Rules`), as many as the band holds. A session without a goal has a band only when the repository has goals paused or running in other sessions: `openplan · 2 goals paused`.
- A session without a goal has a pane that says so, and how to start one or take one up.
- **Asks**: what needs you, as it comes, in Claude Code's own question dialog (`$.ui.ask`), one at a time in the order it came, in the session that runs the goal, whether or not it is in a turn. A member's permission request offers allow once, allow always where Claude Code suggests a rule, and deny; an answer typed instead denies it with that note. A member's question is put as they asked it, one question after another, with what each option means; what you type that answers nothing leaves it in "Needs you", and a toast says so. A stuck review or a merge offers its decisions, with the review's notes or the files that can't be merged: a review sent back too often goes back with its notes, and your note if you type one; a review that failed has no notes, so it goes back only with the note you type; files git can't merge line by line keep one side or merge again; a merge git failed on is tried again or stopped, its delivery standing. Typed text sends a review's work back with that note, and the pane offers the same as a note to type. A task done that you accept is your session's to ask (§7.3), not an ask. The mod asks and the mod answers: no model sees the dialog or the answer, so what Claude Code still asks after its own checks is answered by you. Dismissed, or "Chat about this", it stays open in "Needs you".
- **Transcript rows**, dim, for milestones (plan approved, subtask merged, sent back), so the conversation keeps a timeline without model turns.
- **Without drawing** (`claude -p`, a terminal too narrow): `/openplan status` prints the same as text, and every record is a file in the data folder.

### 7.3 Your session

Your session talks; the pane shows and answers. `/openplan pause` pauses your session's goal, and `/openplan resume` resumes it, or takes up one of the repository's goals not running here (§3.2): the only one, or, with several, the one you pick in Claude Code's question dialog, each listed by name, how far it got, and whether it is paused, archived or running in another session (one this openplan can't read by its folder and why, the rest listed all the same); more than the dialog's four are listed numbered, for `/openplan resume <number>`. While your session's goal is active, `/openplan resume` says to pause it first. Neither spends a model turn: they are certain. The tools your session has, all about its own goal: see where it stands, and the repository's other goals by name, how far each got and where (`status`); start a goal (`start_goal`), refused while the session's goal is active, so your session asks you whether to pause it first; a paused one it lets go; hold a meeting (`hold_meeting`, its host the first attendee, `host_only` if they only run it), cancel one (`cancel_meeting`) or resume one that failed or was cancelled (`resume_meeting`); show a plan under review (`show_plan`), change it (`change_plan`, which also ticks the tasks you accept) or approve it (`approve_plan`); assign a subtask directly (`assign`); pause, resume, archive or delete the goal (`goal_action`); stop, go on, retry or redo a subtask (`subtask_action`); pass a message to a member (`@GLM put the scoreboard top right`) about one of their subtasks (`message`, naming the subtask: a member may have several), which goes on in that subtask's session; and carry out your decision on a task done, a stuck review or a merge (`decide`).

A tool that names a member (a meeting's attendees, an assignee, a plan's owners) takes only the goal's members, each listed with their role in its schema, so your session matches what you said against the team as it would against any tool's options. Before a goal, they list the team as its files have it. When the session starts or takes up a goal, the server tells Claude Code its tools changed (`notifications/tools/list_changed`).

Your session is woken only for what needs a conversation: a plan to review and a task to accept. The pane's view lists each, and the mod submits each new one to your session with `$.prompt.submit`, Claude Code's call for a plugin's prompt: an idle session starts a turn with it, read as a message from the openplan plugin. When you take a goal up, what already waits in it for a conversation is put to your session at once: taking it up is yours, so the turn it starts is too.

openplan's prompts and tool results are in English, written for the model. What your session says to you stays in your language: the MCP server's instructions, which Claude Code gives your session every turn, tell it to talk to you in the language you write in, whatever openplan's text is in.

## 8. Permissions

Members work under Claude Code's own permission modes and rules, set per team. Every member session also gets, as flag settings: openplan disabled (`enabledPlugins`), so a member never starts a team of its own: the id read back from the data folder, which renames every character but letters, digits, `_` and `-` to `-`, and every `openplan@…` your user and project settings name, since a marketplace's name may have a `.` that doesn't read back; `crossSessionInbound: refuse` and `SendMessage` and `ListAgents` denied, so members take no messages from your sessions and send none; and `--name openplan-<member>`, so a running member shows under its name in `claude agents`. Bare mode is not used: it would also drop the repository's `CLAUDE.md`. A member's turn runs in your session's permission mode, as you started it or switched it since (Shift+Tab): the mode of your last message, or of your session's last call to openplan, one of which comes before any work starts (§3.3). So a session in `bypassPermissions` has members that ask nothing, and a session that asks has members that ask. A team whose `settings.json` sets `permissions.defaultMode` has its members in that mode instead. openplan adds no permission default or sandbox of its own: a member loads your user and project settings as any session of yours does, so what Claude Code would let it do, or ask about, is what your settings say. A call Claude Code asks about becomes a permission request in "Needs you", and the member's turn waits for your answer: allow it once, deny it (with a note the member reads), or, where Claude Code suggests a rule for it, allow it always, which adds that rule to the repository's `settings.json` and the goal's copy (§6), so every member of the goal works under it from then on. Meetings, teammates' answers and reviews run read-only: the read-only tools, and no MCP server but the turn's own (`strictMcpConfig`). Yours would offer tools that do more than read; and a resumed session connects them partway through its turn, which changes its tools and writes the conversation's prompt cache again whole. In the first real meeting that cost the host 60k, 124k and 187k tokens of cache written on successive turns. Working sessions keep your MCP servers.

## 9. What it fixes

Each row names the tests that show it, under `src/engine/`. They run the engine against scripted SDK message streams or stubbed runs, with real git; none calls a model.

| Problem elsewhere                                                             | openplan                                                                                                                     | Shown by                                                                                          |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A worker's state is guessed from its terminal; it gets stuck                  | Every status change comes from an SDK event; a run that ends without delivering is reminded once, then fails with the reason | `run.test.ts`                                                                                     |
| Worker permissions are bypassed                                               | A member's out-of-rule call waits for your answer in "Needs you"                                                             | `questions.test.ts`: a call outside the rules                                                     |
| The process lives in the lead's prompt; the lead stops early or does the work | The scheduler starts and finishes work; your session only relays                                                             | `scheduler.test.ts`: runs a subtask in its worktree                                               |
| The team's memory is the lead's context, lost on compaction                   | All state is the engine's, in the data folder; your session holds none, so compacting or clearing it loses nothing           | By construction (§3.2); `engine.test.ts`: pauses what a session killed outright left active       |
| A failed worker restarts from scratch                                         | An API error mid-subtask: "go on" resumes the same session in the same worktree                                              | `scheduler.test.ts`: go on with a failed subtask                                                  |
| Review cannot send work back                                                  | A failed review returns the subtask to its member with the notes                                                             | `scheduler.test.ts`: sends it back with the notes                                                 |
| Teammates overwrite each other's files                                        | Two subtasks edit one file: each in its worktree; the later merge's conflict goes back to its member                         | `scheduler.test.ts`: sends a text conflict back                                                   |
| Closing the terminal loses the team's work                                    | Close Claude Code mid-run: its goal pauses; take it up again, and members go on in their sessions and worktrees              | `engine.test.ts`: pauses every active goal as it closes; `scheduler.test.ts`: stops with its goal |

## 10. Verified, and what is left

Checked on Claude Code 2.1.322 and Agent SDK 0.3.322, with a probe plugin and a mock Messages API:

- When Claude Code is killed, the MCP server's stdin ends at once, in time to stop its children.
- A member whose parent is killed outright keeps calling the model through its turn (five requests, up to its turn limit, in the probe).
- Your user settings' `env` overrides the environment a member is started with; flag settings override both. Inline flag settings appear on the member's command line.
- The MCP server inherits the session's own variables (`CLAUDE_CODE_MESSAGING_SOCKET` and `_TOKEN`, `CLAUDE_CODE_SESSION_ID`, `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `AI_AGENT`, `CLAUDE_EFFORT`, `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PROJECT_DIR`); members are started without them.
- A plugin's `$.prompt.submit` starts a turn in the idle session at once; the transcript shows it as a prompt from that plugin.
- `/clear` keeps the MCP server running: it ends one session id and starts another (SessionEnd `clear`, SessionStart `clear`) in the same process.
- A member started with default options loads every enabled plugin, openplan included, and has `SendMessage` and `ListAgents`; the flag settings in §8 remove both. Every member binds an inbox socket and is listed by `claude agents` as an interactive session, under its `--name`.

- An MCP server is not given `CLAUDE_PID` (hooks are); its parent process is the session. A command-form hook is the session's child too.
- A plugin's skill takes the plugin's name as its short command: a skill named `openplan` in the plugin `openplan` keeps the mod from registering `/openplan`, `user-invocable: false` or not.
- A plugin's `$.prompt.submit` from a `command.run` hook is refused, as it would wait on the command's own run; from a timer after it, it starts the turn. `/openplan <task>` so reaches the session, with the roster of a team kept only in `CLAUDE_CONFIG_DIR/openplan/`.
- `$.mcp.call` runs as a tool call: a PreToolUse and a PostToolUse hook in your settings run around each one (79 of each in 40 s of the pane's old 500 ms poll). `$.http.fetch` over a Unix socket runs none; the pane's poll there takes 1 to 4 ms.
- Claude Code refreshes a server's tools on `notifications/tools/list_changed`, so the member names in the tools follow the team as it is read.
- Loaded with `--plugin-dir` against the mock: the first start installs the dependencies and connects in about 5 s, later ones at once; the band, `/openplan`, `/openplan status`, the pane and the SessionStart context all show the team as its state file has it.

Left: whether the pane redraws smoothly, polling its socket every 500 ms, while a meeting streams.

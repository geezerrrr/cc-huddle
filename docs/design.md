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

| Concept       | What it is                                                                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role          | A job and its duties, e.g. `gameplay-programmer`. A file in the team folder.                                                                                         |
| Member        | Someone on the team: a name, a role, a provider, a model and an effort. A file in the team folder.                                                                   |
| Goal          | What you want done, with its own branch `openplan/<goal>/main` cut from your `HEAD` when it starts.                                                                  |
| Meeting       | A read-only discussion among chosen members that ends in a plan for a goal.                                                                                          |
| Plan          | The host's document plus a tree: tasks, their subtasks, an owner, dependencies and acceptance criteria for each.                                                     |
| Task, subtask | A task is one result for you, its subtasks done; a subtask is one member's piece of work, done in one worktree. You accept a task yourself only where you chose to.  |
| Question      | Anything that waits on someone: a member asking a teammate or you, a permission request, a decision on a stuck review or merge, a finished task you chose to accept. |
| Your session  | The Claude Code session you talk in. It relays what you want and acts on it through tools. It never does the team's work.                                            |

A member is busy while a subtask of theirs runs or waits on its review, while they review a delivery, or while they sit in a meeting. A busy member starts nothing new. Everyone does one thing at a time.

## 3. Architecture

Two layers. The engine knows nothing of the plugin.

```
┌─────────────────── Claude Code (your session) ───────────────────┐
│  mod: pane, band, toasts, /openplan          skill               │
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

The team belongs to the session it runs in, like everything else that session starts. The engine runs inside the session's MCP server, which Claude Code starts with the session and ends with it, and the member processes are its children. There is no process of openplan's own outside a session. Members run the Claude Code your session runs, found as the MCP server's parent process, so they share its version and install, and openplan ships no Claude Code of its own. A member never outlives the MCP server either: an orphaned Claude Code process goes on with its turn, calling the model, until the turn ends. The MCP server stops its members when the session ends and when it exits for any reason it can catch, a crash included. Each member's pid is recorded in the data folder with its settings file, so a start after a server that was killed outright stops what it left, once the process's command line shows that file.

Closing the session pauses every active goal, as if you had paused each one (§4.1): running subtasks are held in their sessions (a merge under way finishes first), a running meeting is cancelled, open questions stay open, sessions and worktrees are kept. Resuming the session brings back its context and shows the paused goals; nothing starts again until you resume one. A session killed outright couldn't pause its goals: the next one to open the team pauses them, and its SessionStart context says so. To keep the team working while you are away, keep the session running, in the background if you like, the way Claude Code already offers.

`/clear` only clears the conversation: the team keeps working, and the new conversation learns where it stands from the SessionStart hook and the tools.

The team is the session's that uses it. Claude Code doesn't keep a conversation in one process: the Agent view (`←` on an empty prompt) moves it to a process of its own, and processes started ahead of need run their MCP servers and hooks with no conversation yet. So the team isn't bound to the process that started first. The MCP server opens the team when it is first asked for it, not as it starts. The band and the pane, as they look, open it only when no session holds it. Using openplan, which means a tool of your session's, an answer in the pane or `/openplan`, also takes it over from a session that holds it. Taking over is a hand-over: the holder pauses its active goals as when it closes, lets the team go, and says which goals it paused and which of their meetings it stopped; the taker opens the team and resumes them, so members go on in their sessions and worktrees, now as the taker's children. The session that let the team go shows that it moved, and takes it back the same way when you use openplan there.

One session runs a repository's team at a time, held by a lock in the repository's data folder with the pids of the MCP server and its session, where the server is asked to let the team go (its pane socket, §3.3), and whether it has opened the team yet. The lock is put in place whole, so of sessions starting at once one takes it. A lock whose holder has ended is replaced by the one taker that claims that ending (a file named for the ended pid), and only while it is still that holder's, so a lock taken meanwhile is never replaced.

### 3.3 Plugin

- **MCP server `openplan`**: the engine and the tools your session uses (§7.3). The pane reads the team twice a second from the server's own socket: `POST /view` gives the team as the pane draws it and a member's record from where it left off. It doesn't go through `$.mcp.call`, which Claude Code runs as a tool call, with your PreToolUse and PostToolUse hooks around it each time. The socket is one per session, in a folder only you can read (a named pipe on Windows), and does only one thing besides reading: `POST /release` lets the team go to another of your sessions that takes it over (§3.2). Two more tools serve the mod: `pane` names the socket, once, and `answer` carries what you pressed. The mod keeps both from your session's model, so an answer comes only from you.
- **Mod**: the pane, the band, toasts, transcript rows and the `/openplan` command (§7.2), and the prompts that wake your session (§7.3). `/openplan <task>` hands your session the task for the team; the pane and `status` run without a model turn.
- **Skill**: tells your session what it is for: relay and act, never do the work itself.
- **SessionStart hook**: tells your session what stopped or waits on you, as context. The mod shows you the same in the band.
- **Permission mode hook**: keeps your session's permission mode for its members (§8). Claude Code gives `permission_mode` to the `UserPromptSubmit` hook, and to `PreToolUse`, here only on openplan's own tools; the hook writes it to the data folder under the session's pid, where the MCP server of that session reads it. A file whose session has ended goes as the next one is written.

The repository's `plugin/` folder is the plugin, listed by the marketplace at the repository's top, so it installs with `/plugin install`. The MCP server and the hook are bundled into `plugin/dist/`, committed so an install needs no build. The Agent SDK isn't openplan's to ship: the server's npm dependencies are installed into the data folder the first time a version starts, with `npm ci` from `dist/package.json` and the `dist/package-lock.json` beside it, so every install gets the same tree, without the optional platform binaries, since members run your session's Claude Code.

### 3.4 Where things live

| What                                        | Where                                                                        | In git                            |
| ------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------- |
| Team: roles, members, settings              | `~/.claude/openplan/`, and `.claude/openplan/` in the repository             | The repository's, yours to commit |
| State, meeting records, plans, logs, events | `${CLAUDE_PLUGIN_DATA}/repos/<repo-id>/`                                     | No                                |
| Worktrees                                   | `${CLAUDE_PLUGIN_DATA}/repos/<repo-id>/goals/<goal>/` and `desks/<subtask>/` | Branches only                     |
| The MCP server's npm dependencies           | `${CLAUDE_PLUGIN_DATA}/deps/<version-hash>/`                                 | No                                |

`${CLAUDE_PLUGIN_DATA}` is the data folder Claude Code gives each plugin (`~/.claude/plugins/data/<plugin-id>/`). It is passed to the MCP server and the hooks. It survives plugin updates and is removed on uninstall, worktrees included; their branches stay in your repository, and git prunes the stale worktree entries on its own. `claude plugin uninstall --keep-data` keeps it.

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

Pausing holds its running subtasks in their sessions and cancels its running meeting. Deleting removes its worktrees and subtask branches; its branch `openplan/<goal>/main` stays.

### 4.2 Meeting

| From              | Event                                      | To                             |
| ----------------- | ------------------------------------------ | ------------------------------ |
| —                 | start: goal active, every participant free | running                        |
| running           | the host's plan parses                     | review                         |
| running           | error                                      | failed                         |
| running           | you cancel, goal paused or archived        | cancelled                      |
| review            | you change the plan                        | review                         |
| review            | you approve                                | approved                       |
| review            | you cancel, goal archived                  | cancelled                      |
| failed, cancelled | you go on (no plan yet)                    | running, from where it stopped |

The flow is Crewloft's (its `team.md` §4): the host opens with the questions to settle; every member gives a first judgment, all at once and without hearing each other; members raise a hand to speak; the host gives the floor, closes when every question is settled or the size's turn budget is spent, and writes the plan. Sizes (`small`, `discussion`, `large`) set only how many turns each member gets. Meeting sessions are read-only.

A meeting is for lining up, not for working out details. It settles the direction (what to make and the few choices that shape it), who does which piece, and which interfaces there are between the pieces (names, conventions or formats one piece defines and another uses) and who defines each. What an interface holds and how a piece is built are worked out afterwards by whoever does it; whoever needs it asks them (`ask_teammate`). Every turn keeps to that: the opening, the first judgments, what the host asks of whom, a hand worth the floor. A turn says only what hasn't been said, its conclusion and its reason.

- **The host.** You name who attends, and the first named hosts; with nobody named, everyone attends and the first member by name hosts. A host takes part as well, by default: they give a first judgment like everyone, answer for their own piece in the talk, have their view weighed like anyone's, and get work in the plan. A host who only runs it (`hostOnly`) gives no judgment, takes no side and gets no work; it takes someone else to run it for. The members are everyone attending but a host who only runs it; the first judgments and the plan's assignees are theirs.
- **The floor.** The host gives it to one member with `give_floor`, saying what they need from them, or gives it to nobody, which closes the talk, hands up or not. A hand about what an interface holds or how a piece is built isn't worth the floor. With no hand worth it, the host checks what they set out to decide one thing at a time against what was said (nobody objecting isn't it), then puts the split to the room once (the pieces, who takes each, the interfaces and who defines each) before closing. What the host says before handing over the floor is said to the room, as what follows is.
- **The plan.** Subtasks follow what each piece needs from another: a subtask depends only on those whose results it uses. An interface others wait on is defined first, in a quick subtask of its own by whoever defines it; putting the pieces together and checking the whole is a subtask at the end. Beyond that, one member's piece is one subtask, since each subtask carries a fixed cost (a new session getting to know the repository, a review, a merge). No task comes for you to accept: which ones you accept yourself is yours to tick in review (§7.1).

Each attendee keeps one session for the whole meeting, in the goal's worktree. An approved plan's document is saved in the data folder, and the first run of each of its subtasks gets it in its brief, since members work in their worktrees and not in the data folder.

### 4.3 Subtask

| From                                                  | Event                                                           | To                                                      |
| ----------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------- |
| —                                                     | plan approved, or assigned directly                             | pending                                                 |
| pending                                               | upstream merged, owner free, goal active                        | running                                                 |
| pending, running, reviewing, merging (waiting on you) | you stop it                                                     | stopped                                                 |
| running                                               | delivered, review on                                            | reviewing                                               |
| running                                               | delivered, review off                                           | merging                                                 |
| running                                               | error, or no delivery after one reminder                        | failed                                                  |
| running                                               | goal paused, you add to it                                      | pending, same session                                   |
| reviewing                                             | passed, or you skip the review                                  | merging                                                 |
| reviewing                                             | sent back (first two times)                                     | pending, same session, with the notes                   |
| merging                                               | merged                                                          | done                                                    |
| merging                                               | text conflicts                                                  | pending, same session, to resolve them                  |
| failed, stopped                                       | retry                                                           | pending, fresh session and worktree                     |
| failed, stopped                                       | go on                                                           | pending, same session and worktree                      |
| stopped (after delivery)                              | go on                                                           | reviewing or merging, where it stopped                  |
| done                                                  | redo: upstream redone, you add to it, or you send its task back | pending, same session, worktree rebuilt from the branch |

A third failed review, a review that errors, a binary conflict and a git error each become a decision for you (§4.4) rather than a move.

A running subtask's member has two tools beyond Claude Code's own, from an in-process MCP server given to its turn: `ask_teammate`, a question a teammate answers in a read-only session, and `deliver`, a summary and the files that are the result. A run is done only once it delivers. The Team tab follows its steps from its own `TodoWrite` calls.

### 4.4 Question

| From | Event                   | To        |
| ---- | ----------------------- | --------- |
| —    | asked                   | open      |
| open | answered                | answered  |
| open | the asker stops waiting | cancelled |

Kinds: a teammate's question (answered by that teammate in a read-only session), a question to you (Claude Code's own `AskUserQuestion`, intercepted), a permission request, a decision (stuck review, binary conflict, git error), and a finished task you chose to accept. Answered and cancelled questions leave the state.

### 4.5 Derived, never stored

- What a subtask waits on: an upstream subtask, a busy owner or reviewer, a paused goal, a teammate's or your answer. Upstream work in a task you accept yourself is waited on as that whole task, done and accepted; in any other task, only the subtasks depended on, merged.
- Who is busy, who reviews a delivery (the meeting's host, else another member), whose upstream was redone after it started.
- What you can do to each subtask, meeting and goal: asked of the same tables with `can`.

## 5. Git

- A goal's branch `openplan/<goal>/main` is cut from your `HEAD` when it starts and checked out in the goal's own worktree in the data folder. Meetings and reviews read the goal there, and merges land there. While the goal has that worktree, git keeps the branch from being checked out anywhere else, so nothing moves under a checkout of yours; diff it, merge it, or open the goal's folder. If the name is taken (any branch under `openplan/<goal>/`, from a deleted goal or another clone), the goal takes `<goal>-2` and so on.
- Each subtask works in its own worktree on branch `openplan/<goal>/<subtask>` (a goal's branches share one folder of refs, since git can't hold both `openplan/<goal>` and `openplan/<goal>/<subtask>`), cut from the goal branch when it first starts, kept through send-backs, conflicts and pauses, removed when merged.
- Delivering commits what is uncommitted in the worktree as the member (`<name> <member-id>@openplan.local`). Members don't commit: Claude Code asks before any git command that writes, even in the sandbox, so a commit of theirs would wait on you.
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

A member session loads your user and project settings like any session of yours. On top, as flag settings, which outrank both: the team's `settings.json`, the member's `env`, and the guards of §8. Your own settings' `env` would otherwise override the member's. The engine writes these to a file only you can read in the data folder as the team opens, and again as you allow a rule always (the rule goes in the repository's `settings.json`), and passes its path, since settings given inline end up on a command line where other processes can read them.

## 7. Interaction

### 7.1 A goal, end to end

1. You hand the team a task: `/openplan build a two-player dice game, GLM on the art`, or ask your session in words. The command makes it the team's for certain: the mod gives your session the task, the team's roster, and the rule not to do it itself.
2. Your session proposes who takes it, keeping to anyone you named: a meeting (who attends, the host first and whether they only run it, what each brings) or one member for work that needs no planning. It asks with `AskUserQuestion`: start, or say what to change; it proposes again until you start. Then it starts the goal and holds the meeting or assigns the work, and returns at once.
3. The meeting runs in the background. You watch it live in the pane.
4. The plan is ready: your session wakes, shows you the plan in full, its document and its tasks with who does what, on what each waits and which you accept, and asks with `AskUserQuestion`: approve, change it, or drop it, and which tasks, if any, you want to accept yourself once done. None is by default: code is checked by its reviewer and its checks, and you would rarely read it line by line; a task is worth your own acceptance when only looking at it or trying it can judge it. Changes are said in words, and your session rewrites the plan with them; any member can be given work, not only those who attended.
5. Members work. Everything that needs you lands in the pane's "Needs you" tab with a toast, and the pane opens where it docks beside the transcript; you answer there with its own options.
6. A task is done once its last subtask merges, and the transcript says so. One you chose to accept waits for you instead: your session wakes to ask, and work in other tasks that builds on it waits until you accept it. Either way, to change a done task, pass its member a message (§7.3); work built on it is marked as built on something redone. Work you assign directly is a task you don't accept.

### 7.2 What you see

- **Pane** (`/openplan`), beside the transcript in a wide fullscreen terminal, above the prompt otherwise. Three tabs:
  - **Meeting**: the discussion word by word, who speaks, raised hands, whom the host calls. The first judgments are formed all at once, so they don't stream: the pane says the members are forming them, and each shows once given.
  - **Team**: one line per member: what they do, which step, whom they wait on, tokens. Select a member to follow their record live: thinking, tool calls, files changed.
  - **Needs you**: each open question with its options as buttons. Pressing one answers it. Nothing goes through a model, so a permission is granted only by you.
- **Band** above the prompt, always: `openplan · meeting · 3 working · 1 needs you`, and under it a line for each task not yet done: its title and where it stands (`Rules · bob works on it`, `Board · waits on Rules`), as many as the band holds.
- **Toast** when something new needs you.
- **Transcript rows**, dim, for milestones (plan approved, subtask merged, sent back), so the conversation keeps a timeline without model turns.
- **Without drawing** (`claude -p`, a terminal too narrow): `/openplan status` prints the same as text, and every record is a file in the data folder.

### 7.3 Your session

Your session talks; the pane shows and answers. `/openplan pause` and `/openplan resume` pause or resume every goal at once, without a model turn: they are certain, so they don't spend one. The tools your session has: see where the team stands (`status`); start a goal (`start_goal`); hold a meeting (`hold_meeting`, its host the first attendee, `host_only` if they only run it), cancel one (`cancel_meeting`) or resume one that failed or was cancelled (`resume_meeting`); show a plan under review (`show_plan`), change it (`change_plan`, which also ticks the tasks you accept) or approve it (`approve_plan`); assign a subtask directly (`assign`); pause, resume, archive or delete a goal (`goal_action`); stop, go on, retry or redo a subtask (`subtask_action`); pass a message to a member (`message`: `@GLM put the scoreboard top right`), which goes on in that member's session; and carry out your decision on a task done, a stuck review or a merge (`decide`).

A tool that names a member (a meeting's attendees, an assignee, a plan's owners) takes only the team's members, each listed with their role in its schema, so your session matches what you said against the team as it would against any tool's options. When the team is read again, the server tells Claude Code its tools changed (`notifications/tools/list_changed`).

Your session is woken only for what needs a conversation: a plan to review and a task to accept. The pane's view lists each, and the mod submits each new one to your session with `$.prompt.submit`, Claude Code's call for a plugin's prompt: an idle session starts a turn with it, read as a message from the openplan plugin. What waits already when the team opens is the SessionStart hook's to tell.

## 8. Permissions

Members work under Claude Code's own permission modes and rules, set per team. Every member session also gets, as flag settings: openplan disabled (`enabledPlugins`), so a member never starts a team of its own; `crossSessionInbound: refuse` and `SendMessage` and `ListAgents` denied, so members take no messages from your sessions and send none; and `--name openplan-<member>`, so a running member shows under its name in `claude agents`. Bare mode is not used: it would also drop the repository's `CLAUDE.md`. A member's turn runs in your session's permission mode, as you started it or switched it since (Shift+Tab): the mode of your last message, or of your session's last call to openplan, one of which comes before any work starts (§3.3). So a session in `bypassPermissions` has members that ask nothing, and a session that asks has members that ask. A team whose `settings.json` sets `permissions.defaultMode` has its members in that mode instead. openplan adds no permission default or sandbox of its own: a member loads your user and project settings as any session of yours does, so what Claude Code would let it do, or ask about, is what your settings say. A call Claude Code asks about becomes a permission request in "Needs you", and the member's turn waits for your answer: allow it once, deny it (with a note the member reads), or, where Claude Code suggests a rule for it, allow it always, which adds that rule to the team's `settings.json` so every member works under it from then on. Meetings, teammates' answers and reviews run read-only: the read-only tools, and no MCP server but the turn's own (`strictMcpConfig`). Yours would offer tools that do more than read; and a resumed session connects them partway through its turn, which changes its tools and writes the conversation's prompt cache again whole. In the first real meeting that cost the host 60k, 124k and 187k tokens of cache written on successive turns. Working sessions keep your MCP servers.

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
| Closing the terminal loses the team's work                                    | Close Claude Code mid-run: its goals pause; resume the session and a goal, and members go on in their sessions and worktrees | `engine.test.ts`: pauses every active goal as it closes; `scheduler.test.ts`: stops with its goal |

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

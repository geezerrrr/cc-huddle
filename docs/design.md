# cc-huddle design

This document is the source of truth for how cc-huddle behaves. Change it first, then the code; code that disagrees with it is a bug.

## 1. What it is

cc-huddle is a Claude Code plugin that runs a team of Claude Code sessions on your repository. Each member has a role and its own model, which can come from any provider with an Anthropic-compatible API. A goal starts with a meeting where the members compare approaches and the host writes a plan of tasks with owners, dependencies and acceptance criteria. You approve the plan, and the members work in parallel, each subtask in its own git worktree. Their deliveries are reviewed, sent back when they fail, and merged into the goal's branch. You are asked only when something needs you.

What makes it different is where the rules live. Agent Teams and prompt-driven orchestrators ask a lead model to follow a process. cc-huddle keeps the process in state machines in code: the models decide what to write, never which step comes next. Workers are driven through the Agent SDK, so the engine sees every tool call, permission request, question and result as a structured event and never guesses a terminal's state.

cc-huddle comes out of [Crewloft](https://playcrewloft.com), a game in which the same engine runs a studio of AI staff.

### Not in scope

- A user interface of its own. Everything you see is drawn inside Claude Code (§7).
- Single focused jobs. A subagent is cheaper and quicker for one search, one review or one module; cc-huddle is for work with several people, steps and dependencies.
- Pushing, opening pull requests, or touching your checkout. The team works on its own branches; merging them is yours.

## 2. Concepts

| Concept       | What it is                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role          | The angle a member sees the work from, by its name, e.g. `developer`. Optionally a file with the team's own principles for it.                                                              |
| Member        | Someone on the team: a name, a role, a provider, a model and an effort. An entry in `team.yaml`.                                                                                            |
| Goal          | What you want done, run by one session (§3.2): its own branch `huddle/<goal>/main` cut from your `HEAD` as it starts, its own copy of the team as it was then, its own state, and one plan. |
| Meeting       | A read-only discussion among chosen members that ends in a plan for a goal.                                                                                                                 |
| Plan          | The host's document plus a tree: tasks, their subtasks, an owner, dependencies and acceptance criteria for each.                                                                            |
| Task, subtask | A task is one result for you, its subtasks done; a subtask is one member's piece of work, done in one worktree. You accept a task yourself only where you chose to.                         |
| Question      | Anything that waits on someone: a member asking a teammate or you, a permission request, a decision on a stuck review or merge, a finished task you chose to accept.                        |
| Your session  | The Claude Code session you talk in. It relays what you want and acts on it through tools. It never does the team's work.                                                                   |

A goal's work comes from one planning: the plan of its meeting, or, when one member is picked, the task handed to them as the goal starts. Nothing is added to a goal afterwards; a new need is a new goal.

A member is busy while a subtask of theirs runs or waits on its review, or while they review a delivery. With `parallel` off (§6.1), the default, a busy member starts nothing new: everyone does one thing at a time in a goal. With it on, a member runs every subtask of theirs that waits on nothing else at once, each in its own session and worktree, and reviews a delivery whatever else they are doing. Two goals run by two sessions each have their own copy of the member, each in Claude Code processes of its own.

## 3. Architecture

Two layers. The engine knows nothing of the plugin.

```
┌─────────────────── Claude Code (your session) ────────────────────┐
│  mod: asks, pane, band, /huddle            skill                  │
│        │ socket: view    $.mcp.call: pane, answer                 │
│  MCP server `huddle`: tools ── engine: state machines ·           │
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
- **Policy**: the options of every session: tools, permission mode, the flag settings of §8, environment. It adds no sandbox or permission default of its own (§8).
- **Prompts**: every prompt the engine sends, in one module.

It is ported from Crewloft's engine without the game: no economy, life, seats, account or layout.

### 3.2 Lifetime

A goal belongs to the session it runs in, like everything else that session starts. The engine runs inside the session's MCP server, which Claude Code starts with the session and ends with it, and the member processes are its children. There is no process of cc-huddle's own outside a session. Members run the Claude Code your session runs, found as the MCP server's parent process, so they share its version and install, and cc-huddle ships no Claude Code of its own. A member never outlives the MCP server either: an orphaned Claude Code process goes on with its turn, calling the model, until the turn ends. The MCP server stops its members when the session ends and when it exits for any reason it can catch, a crash included. Each member's pid is recorded in the goal's folder with its settings file, so a start after a server that was killed outright stops what it left, once the process's command line shows that file.

Closing the session pauses its goal, as if you had paused it (§4.1): running subtasks are held in their sessions (a merge under way finishes first), a running meeting is cancelled, open questions stay open, sessions and worktrees are kept. Resuming the session brings back its context; nothing starts again until you take the goal up again (`/huddle resume`). A session killed outright couldn't pause its goal: the next one to take the goal up pauses it first. To keep the team working while you are away, keep the session running, in the background if you like, the way Claude Code already offers.

`/clear` only clears the conversation: the goal keeps working, and the new conversation learns where it stands from the SessionStart hook and the tools.

A session runs one goal, and a goal runs in one session. To run several goals at once, run several sessions, as with Claude Code itself: each goal has its own folder and its own copy of the team, so goals don't touch each other's files, and where their work meets in your repository, merging it settles it, as it does for any two sessions. A session starts a goal (`start_goal`), or takes one up with `/huddle resume`, which lists the repository's goals that aren't running here, each by name and how far it got, and whether it is paused, archived or running in another session; you pick one. Taking up a goal another session runs is a hand-over: that session pauses it, lets it go, and says what it stopped; this one opens it and resumes that, so members go on in their sessions and worktrees, now as this one's children, and the session that let it go shows that it moved. A session whose goal is active refuses to start another or take one up, and says why: pause it first, or use another session; it never asks. One whose goal is paused, archived or closed (§4.1) lets it go.

Claude Code doesn't keep a conversation in one process: the Agent view (`←` on an empty prompt) moves it to a process of its own, with a session id of its own and nothing that names the one before, and processes started ahead of need run their MCP servers and hooks with no conversation yet. So a goal doesn't follow its conversation by itself: in the new process, take it up with `/huddle resume`, where it is listed as running in another session. The MCP server opens a goal only when its session starts or takes one up, never as it starts.

Each goal is held by a lock in its folder with the pids of the MCP server and its session and where the server is asked to let the goal go (its pane socket, §3.3). The lock is put in place whole, so of sessions taking a goal at once one gets it. A lock whose holder has ended is replaced by the one taker that claims that ending (a file named for the ended pid), and only while it is still that holder's, so a lock taken meanwhile is never replaced. Whatever cc-huddle puts in place whole (the lock, the goal's state, the server's dependencies) it writes beside and renames over; on Windows, where an antivirus or an indexer holding a new file or folder a moment refuses the rename, it tries again for a few seconds, as npm does.

### 3.3 Plugin

- **MCP server `huddle`**: the engine of your session's goal and the tools your session uses (§7.3). The pane reads the team twice a second from the server's own socket: `POST /view` gives the team as the pane draws it, the record of the member it follows from where it left off (from the start of their new work once they are on it), and the turn being spoken at the meeting the same way. It doesn't go through `$.mcp.call`, which Claude Code runs as a tool call, with your PreToolUse and PostToolUse hooks around it each time. The socket is one per session, in a folder only you can read (a named pipe on Windows), and does only one thing besides reading: `POST /release` lets the goal go to another of your sessions that takes it up (§3.2). More tools serve the mod: `pane` names the socket, once, `answer` carries what you pressed, `review_plan` what you decided on a plan, `resume_goal` carries `/huddle resume`, `hand_off` makes the prompt `/huddle <task>` gives your session, and `switch_settings` carries `/huddle review`, `/huddle meeting` and `/huddle parallel` (§6.1). The mod keeps them from your session's model, so an answer comes only from you. `/huddle pause` is your session's `goal_action`.
- **Mod**: the asks, the pane, the band, transcript rows and the `/huddle` command (§7.2), and the prompt that hands your session a change you type to a plan (§7.3). `/huddle <task>` hands your session the task for the team; the pane and `status` run without a model turn. The mod only draws and passes on what you press: what it shows about the team, what each need offers and takes, and when it refuses, are the server's, served as sentences; its own words are its controls and labels, its tabs' empty states, the `/huddle resume` dialog, and what it says when a call fails.
- **Skill**: tells your session what it is for: relay and act, never do the work itself.
- **SessionStart hook**: tells your session, as context, which of the repository's goals are paused and which run in other sessions, and how to take one up. The mod shows the same in the band.
- **Permission mode hook**: keeps your session's permission mode for its members (§8). Claude Code gives `permission_mode` to the `UserPromptSubmit` hook, and to `PreToolUse`, here only on cc-huddle's own tools; the hook writes it to the data folder under the session's pid, where the MCP server of that session reads it. A file whose session has ended goes as the next one is written.

The repository's `plugin/` folder is the plugin, listed by the marketplace at the repository's top, so it installs with `/plugin install`. The MCP server and the hook are bundled into `plugin/dist/`, committed so an install needs no build. The Agent SDK isn't cc-huddle's to ship: the server's npm dependencies are installed into the data folder the first time a version starts, with `npm ci` from `dist/package.json` and the `dist/package-lock.json` beside it, so every install gets the same tree, without the optional platform binaries, since members run your session's Claude Code.

### 3.4 Where things live

| What                                                                                                            | Where                                                                                   | In git                            |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------- |
| Team: members, roles, settings                                                                                  | `~/.claude/huddle/`, and `.claude/huddle/` in the repository                            | The repository's, yours to commit |
| A goal: its copy of the team, its state, lock, plans, records, member settings and the member processes running | `${CLAUDE_PLUGIN_DATA}/repos/<repo-id>/goals/<goal>/`                                   | No                                |
| Worktrees                                                                                                       | `goals/<goal>/checkout/` for the goal, `goals/<goal>/desks/<subtask>/` for each subtask | Branches only                     |
| The MCP server's npm dependencies                                                                               | `${CLAUDE_PLUGIN_DATA}/deps/<version-hash>/`                                            | No                                |
| Each session's permission mode, by its pid (§8)                                                                 | `${CLAUDE_PLUGIN_DATA}/sessions/`                                                       | No                                |

`${CLAUDE_PLUGIN_DATA}` is the data folder Claude Code gives each plugin (`~/.claude/plugins/data/<plugin-id>/`). cc-huddle makes it a folder only you can read: goals' state, records and team copies hold what members said, did and were given. It is passed to the MCP server and the hooks. It survives plugin updates and is removed on uninstall, worktrees included; their branches stay in your repository, and git prunes the stale worktree entries on its own. `claude plugin uninstall --keep-data` keeps it.

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
| active           | close              | closed   |
| archived, closed | delete (confirmed) | removed  |

A goal closes by itself once nothing in it can go on: every task done, those you accept accepted, or its plan dropped. A closed goal has nothing to resume, so `/huddle resume` doesn't list it; its branch stays for you to merge, and the next goal can carry on from it (§5). Pausing holds its running subtasks in their sessions and cancels its running meeting. Deleting removes its folder, its worktrees and its subtask branches; its branch `huddle/<goal>/main` stays.

A session runs one goal (§3.2), so its band, its pane and what wakes it are about that goal alone.

### 4.2 Meeting

| From              | Event                               | To                             |
| ----------------- | ----------------------------------- | ------------------------------ |
| —                 | start: the goal starts with it      | running                        |
| running           | the host's plan parses              | review                         |
| running           | error                               | failed                         |
| running           | you cancel, goal paused or archived | cancelled                      |
| review            | you change the plan                 | review                         |
| review            | you approve                         | approved                       |
| review            | you cancel, goal archived           | dropped                        |
| failed, cancelled | you go on                           | running, from where it stopped |

A goal has one meeting, held as it starts (§2). The flow is Crewloft's (its `team.md` §4): the host opens with the questions to settle; every member gives a first judgment, all at once and without hearing each other; members raise a hand to speak; the host gives the floor, closes when every question is settled or the size's turn budget is spent, and writes the plan. Sizes (`small`, `discussion`, `large`) set only how many turns each member gets. Meeting sessions are read-only.

A meeting is for lining up, not for working out details. It settles the direction (what to make and the few choices that shape it) and how the work is divided. How a piece is built is worked out afterwards by whoever does it; whoever needs something of it asks them (`ask_teammate`). Every turn keeps to that: the opening, the first judgments, what the host asks of whom, a hand worth the floor. A turn says only what hasn't been said, its conclusion and its reason.

The meeting presupposes no way of dividing the work. Each member's first judgment says, besides what they would do, roughly how much code the work takes, as an order of magnitude (hundreds of lines, thousands, tens of thousands), never as time. The host divides by it: work of hundreds of lines is one member's; work of thousands and up is split where its parts can be done at the same time, and where they meet (a format, a protocol, a boundary between layers) is part of the division.

- **The host.** You name who attends, and the first named hosts; with nobody named, everyone attends and the first member by name hosts. A host takes part as well, by default: they give a first judgment like everyone, answer for their own piece in the talk, have their view weighed like anyone's, and get work in the plan. A host who only runs it (`hostOnly`) gives no judgment, takes no side and gets no work; it takes someone else to run it for. The members are everyone attending but a host who only runs it; the first judgments and the plan's assignees are theirs.
- **The floor.** The host gives it to one member with `give_floor`, saying what they need from them, or gives it to nobody, which closes the talk, hands up or not. A hand about how a piece is built, or what goes inside where two pieces meet, isn't worth the floor. With no hand worth it, the host checks what they set out to decide one thing at a time against what was said (nobody objecting isn't it), then puts the division to the room once before closing. What the host says before handing over the floor is said to the room, as what follows is.
- **The plan.** Subtasks follow what each piece needs from another: a subtask depends only on those whose results it uses, and nothing is made sequential that can run at once. Each subtask carries a fixed cost (a review, a merge), so the plan splits work only where its parts run at once or belong to different members. No task comes for you to accept: which ones you accept yourself is yours to tick in review (§7.1).

A meeting that stopped before its plan (failed, cancelled) can go on; one whose plan you dropped can't, and its goal closes (§4.1). Who speaks, whether the plan is being written, the first judgments being formed, who speaks next being weighed, and the hands up are what is under way: the meeting's owner keeps them while it runs, and they aren't in the state.

Each attendee keeps one session for the whole meeting, in the goal's worktree. An approved plan's document is saved in the goal's folder, and the first run of each of its subtasks gets it in its brief, since members work in their worktrees and not in the data folder.

### 4.3 Subtask

| From                                                 | Event                                                    | To                                                      |
| ---------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| —                                                    | plan approved, or the goal starts with one member picked | pending                                                 |
| pending                                              | upstream merged, owner free, goal active                 | running                                                 |
| pending, running                                     | you stop it                                              | stopped                                                 |
| reviewing, review waiting on you                     | you stop it                                              | stopped in review                                       |
| merge waiting on you                                 | you stop it                                              | stopped in merge                                        |
| running                                              | delivered, review on                                     | reviewing                                               |
| running                                              | delivered, review off                                    | merging                                                 |
| running                                              | error, or no delivery after one reminder                 | failed                                                  |
| running                                              | goal paused                                              | pending, same session                                   |
| reviewing                                            | passed                                                   | merging                                                 |
| reviewing                                            | sent back the third time, or the review errors           | review waiting on you                                   |
| reviewing                                            | sent back (first two times)                              | pending, same session, with the notes                   |
| review waiting on you                                | you review it again                                      | reviewing                                               |
| review waiting on you                                | you skip the review                                      | merging                                                 |
| review waiting on you                                | you send it back                                         | pending, same session, with the notes                   |
| merging                                              | merged                                                   | done                                                    |
| merging                                              | text conflicts                                           | pending, same session, to resolve them                  |
| merging                                              | files it can't merge line by line, or a git error        | merge waiting on you                                    |
| merge waiting on you                                 | you keep a side, or merge it again                       | merging                                                 |
| failed, stopped, stopped in review, stopped in merge | retry                                                    | pending, fresh session and worktree                     |
| failed, stopped                                      | go on                                                    | pending, same session and worktree                      |
| stopped in review                                    | go on                                                    | reviewing, its delivery standing                        |
| stopped in merge                                     | go on                                                    | merging, its delivery standing                          |
| done                                                 | you send its task back                                   | pending, same session, worktree rebuilt from the branch |

Your actions (stop, go on, retry) are each one or more events: an action is offered where one of its events can happen, and does that one.

Waiting on you in review or in a merge is a status of its own: its decision (§4.4) is open while the subtask is there, and leaving it, by your answer or your stop, closes it.

A running subtask's member has two tools beyond Claude Code's own, from an in-process MCP server given to its turn: `ask_teammate`, a question a teammate answers in a read-only session, and `deliver`, a summary and the files that are the result. A run is done only once it delivers. The Team tab follows its steps from its own `TodoWrite` calls.

A subtask's first run starts a session of its own, except where it carries on its member's own work: when it depends directly on a subtask of the same member, its session is a fork of that subtask's session (of the one merged last, if several), so the member starts knowing what they did and why, and the conversation already cached is read rather than the repository again. The fork works in the subtask's own new worktree, cut from the goal branch with that work merged, and its brief says so. The plan has already bounded each member's chain to their part of the goal, so a fork carries no more than that part. Every other first run is a fresh session; a retry starts as its first run did.

### 4.4 Question

A question has no status: it is open until answered, or called off when the asker stops waiting. What a member's turn waits on (a teammate's answer, your picks, your leave for a call) ends with the turn, so it lives with the questions and not in the state; only decisions, which no turn waits on, are in the state and outlive a restart.

Kinds: a teammate's question (answered by that teammate in a read-only session), a question to you (Claude Code's own `AskUserQuestion`, intercepted), a permission request, a decision (stuck review, binary conflict, git error), and a finished task you chose to accept.

What each decision offers:

- A review that sent the delivery back too often: review it again, skip the review, or send it back with its notes, and your note if you add one.
- A review that failed: the same, but it has no notes, so it goes back only with a note you type.
- Files git can't merge line by line: keep ours, take theirs, or merge again.
- A merge git failed on: try again, or stop the subtask, its delivery standing.
- A finished task you accept: accept it, or send it back with what to change.

### 4.5 Derived, never stored

- What a subtask waits on: an upstream subtask, a busy owner or reviewer, a merge ahead of it, a paused goal, a teammate's or your answer. Upstream work in a task you accept yourself is waited on as that whole task, done and accepted; in any other task, only the subtasks depended on, merged. With `parallel` off, a member starts one subtask at a time (one going on in its session first, then in the plan's order) and reviews one delivery at a time, the one under way first, then the rest in delivery order; with it on, neither waits on the member's other work. The goal merges one delivery at a time either way. What is under way isn't in the state (after a restart nothing is); the scheduler says, and the rules read it with the state. The scheduler starts exactly what these rules leave waiting on nothing.
- With `parallel` off, a member's work that goes on in its session (held, sent back, conflicts, redone) goes before new work of theirs: new work that could start waits for it while it can start too.
- Who is busy, who reviews a delivery (the meeting's host, else another member), and whether a task you accept is accepted: done, with no acceptance waiting on you.
- What you can do to each subtask, meeting and goal: asked of the same tables with `can`. The scheduler refuses anything else you ask of a subtask, saying why.

## 5. Git

- A goal's branch `huddle/<goal>/main` is cut from your `HEAD` when it starts, or, where the goal your session last ran is closed with commits your `HEAD` doesn't have, from that goal's branch, so a goal started after another carries on from its work whether or not you have merged it yet. It is checked out in the goal's own worktree in the data folder. Meetings and reviews read the goal there, and merges land there. While the goal has that worktree, git keeps the branch from being checked out anywhere else, so nothing moves under a checkout of yours; diff it, merge it, or open the goal's folder. If the name is taken (any branch under `huddle/<goal>/`, from a deleted goal or another clone), the goal takes `<goal>-2` and so on.
- Each subtask works in its own worktree on branch `huddle/<goal>/<subtask>` (a goal's branches share one folder of refs, since git can't hold both `huddle/<goal>` and `huddle/<goal>/<subtask>`), cut from the goal branch when it first starts, kept through send-backs, conflicts and pauses, removed when merged.
- Delivering commits what is uncommitted in the worktree as the member (`<name> <member-id>@huddle.local`). Members needn't commit, and are told so; one that does, where its permissions let it, commits under its own name too, as its environment names it.
- Merges run one at a time per goal, in delivery order: the goal branch is merged into the worktree, then the goal branch fast-forwards to it. Text conflicts go back to the member who delivered last, in their session. Binary and delete/modify conflicts and git errors become your decision.
- Git runs with hooks, fsmonitor and signing off for the engine's own commands. It is the `git` on your `PATH`; members use it as they would anywhere.
- cc-huddle never pushes, never checks out anything in your repository, never runs `worktree prune`, and touches only `huddle/*` branches. The goal branch is yours to merge or review whenever you like.

## 6. Team configuration

```
~/.claude/huddle/          yours, for every repository
.claude/huddle/            the repository's
  team.yaml
  roles/developer.md
  settings.json
```

The team has the two scopes Claude Code's own setup has. Yours sits beside Claude Code's user settings (in `CLAUDE_CONFIG_DIR` when that is set); the repository's beside the rest of its Claude Code setup. The two are read together: a member or role the repository has by the same name replaces yours, and the two `settings.json` merge as Claude Code merges its scopes, arrays joined. Most people keep their members in theirs, written once, and give a repository only what is its own. The team is not in `agents/`: Claude Code would load members there as its own subagents, on its own provider.

As a session starts, cc-huddle writes each of the three files that is missing from yours, and never touches one that is there; a repository's `.claude/huddle/` is yours to make. They come as examples to edit, explained in comments, with no member and no duties of cc-huddle's: `team.yaml` has the team settings of §6.1 at their defaults and members commented out, each line saying what it does; `roles/developer.md` says in comments what a role file is for; `settings.json` is `{"permissions": {"allow": [], "ask": [], "deny": []}}`, with no `defaultMode`, which would take members out of your session's mode (§8). Comments are never read as content.

`team.yaml` lists the members, each by name, with its role, and optionally its model, effort, the environment its Claude Code runs with, and Claude Code settings of its own:

```yaml
review: true
meeting: discussion
parallel: false
members:
  sonnet:
    role: developer
    model: sonnet
    settings:
      permissions:
        allow: ["Bash(pnpm test *)"]
  glm:
    role: designer
    model: glm-5.3-flashx
    effort: max
    env:
      ANTHROPIC_BASE_URL: https://open.bigmodel.cn/api/anthropic
      ANTHROPIC_AUTH_TOKEN: ${GLM_API_KEY}
```

`env` is written as in `.mcp.json`, and takes any variable Claude Code reads: `${VAR}` and `${VAR:-default}` are filled in from the environment cc-huddle runs in, so keys stay out of the files. A member without `env` runs on your own Claude Code sign-in. A member's `settings` go over the team's, as a scope above it.

A role is a name: the angle its members see the work from, at the meeting and in their work. cc-huddle ships no roles and gives none duties. A role may have a Markdown file in `roles/`, named by its file, for the principles a team keeps for that role (its own conventions, what it never does), which every member in it reads, and optionally a `title` in front matter, the file's name when there is none. A role with no file is its name alone. What the whole team works by belongs in the repository's `CLAUDE.md`, which every member loads.

`settings.json` is a Claude Code settings file applied to every member: the permission rules they work under, the sandbox, anything else Claude Code settings hold. It stays apart from `team.yaml` because cc-huddle writes to it too: a rule you allow always (§8).

A member session loads your user and project settings like any session of yours. On top, as flag settings, which outrank both: the team's `settings.json`, the member's own `settings` and `env`, and the guards of §8. Your own settings' `env` would otherwise override the member's. The engine writes these to a file only you can read in the goal's folder as the goal opens, and again as you allow a rule always, and passes its path, since settings given inline end up on a command line where other processes can read them.

A goal copies the team into its folder as it starts, as read then: members, roles, settings, each member's `env` still as written, its `${VAR}`s filled in only as the goal opens, so no key is written down. The goal works with that copy to its end: its plan and who does what were made with that team, so a member removed or changed later is still there for it, and goals started after get the team as it is then. A rule you allow always goes in the repository's `settings.json`, for goals started after, and in the goal's copy, for its members' next turns.

The team's files are read as `/huddle <task>` hands a task over: what is wrong with them is said then, naming the file, before your session proposes anything.

### 6.1 Team settings

`team.yaml` holds three settings of the team's, beside its members, and the repository's file overrides yours, as for members:

- `review`: whether another member reviews each delivery before it merges. `true` by default.
- `meeting`: how long a meeting's discussion runs, `small`, `discussion` or `large` (§4.2). `discussion` by default.
- `parallel`: whether a member does several pieces of work at once (§2, §4.5). `false` by default.

A goal takes them with its copy of the team (§6). You switch them as Claude Code switches `/model`: `/huddle review on|off`, `/huddle meeting small|discussion|large` and `/huddle parallel on|off`, or with no value, picked in Claude Code's question dialog. A switch writes your `team.yaml`, keeping its comments, and your session's goal's copy, if it has one; where the repository's file sets that setting, yours doesn't decide it, and the command says to change it there instead.

## 7. Interaction

### 7.1 A goal, end to end

1. You hand the team a task: `/huddle build a two-player dice game, GLM on the art`, or ask your session in words. Each is a new goal. While your session's goal is active, the command refuses and says why, without a model turn (§3.2). Otherwise the mod gives your session the task with the team's roster; how to take it on is the team skill's.
2. Your session looks at the repository as much as it needs to know what the task asks for, and proposes who takes part, by what the work needs: the members whose angle it needs, anyone you named among them, the host first. It doesn't judge how the work divides; the plan does. It asks with `AskUserQuestion`: start with them, or say what to change; it proposes again until you start. With one member picked, the goal starts with the task assigned to them, no meeting; with several, it starts with their meeting, given what your session found. Either way your session returns at once.
3. The meeting runs in the background. You watch it live in the pane.
4. The plan is ready: it is asked in Claude Code's question dialog, with its summary and its tasks, who does each subtask and what it waits on; the pane's "Needs you" has its document in full. Approve it, approve it and pick the tasks you accept yourself once done, or drop it. None is yours to accept by default: code is checked by its reviewer and its checks, and you would rarely read it line by line; a task is worth your own acceptance when only looking at it or trying it can judge it, and its members then say, as they deliver, how you check their part. What you type instead is the change you want: your session rewrites the plan with your words, and the changed plan is asked again. Any member can be given work, not only those who attended.
5. Members work. Whatever needs you is asked at once in Claude Code's own question dialog, as your session's questions are, and you answer it with a key; one you dismiss waits in the pane's "Needs you" tab.
6. A task is done once its last subtask merges, and the transcript says so. One you chose to accept waits for you instead: it is asked in the question dialog, with what each of its subtasks delivered and how to check it, accept it or send it back with what to change, and work in other tasks that builds on it waits until you accept it. Work assigned to one member as the goal starts is a task you don't accept.
7. Once every task is done, the goal closes (§4.1). What you want next, a change to finished work included, is the next goal: `/huddle <task>` again, which carries on from the closed goal's branch (§5) and plans against the code as it stands.

### 7.2 What you see

- **Pane** (`/huddle`), beside the transcript in a wide fullscreen terminal, above the prompt otherwise. It opens with the keyboard, so Tab and Enter work in it at once; Esc gives the keys back to the prompt. Three tabs, each drawn with its key (`1: Meeting`), and on its last line the keys that work: ↑/↓ scroll, `b: Back` to the team on the meeting and a member's record, `x: Close` closes the pane. What keeps coming, the meeting and a member's record, shows from its end and keeps up as it grows, the way the transcript does: scrolling up lets it go, scrolling back to the end keeps it again.
  - **Meeting**: the discussion word by word, who speaks, raised hands, whom the host calls. The turn being spoken shows what the speaker thinks and looks up as it goes, drawn as a record is; once said, only its words stay. The first judgments are formed all at once, so they don't stream: the pane says the members are forming them, and each shows once given.
  - **Team**: each member in two lines: their name, role, model and tokens, then what they do, which step, or whom they wait on. With `parallel` on, a member doing several things at once has a row for each, under their name, and selecting a row follows that piece of work. The tokens are those their own sessions used: their runs, the reviews they did, their answers to teammates and their meeting turns, each counted to whoever used them. Selecting a member who has worked shows their record live in the team's place, following them onto their next work, as Claude Code shows a teammate's transcript in place of the conversation; the pane's title names them, and Back (b) on the last line shows the team again. A record is drawn as a transcript is, plainly: words as Markdown, thinking in one line, each tool call with its main argument and the first lines of what it gave, and what the Agent SDK reports along the way (a retry, a compaction, a fallback model, a rate limit) in a dim line of words.
  - **Needs you**: each open question with its options as buttons: the ones dismissed from their ask, and every one while it waits. Pressing one answers it. A plan to review shows its document and its tasks, numbered, a box for the numbers of those you accept yourself, Approve and Drop, and a box for the change you want. A member's question shows each option with what it means, as they gave it, and takes an answer typed instead, as the dialog's Other does; one that takes several picks takes them typed. Nothing goes through a model, so a permission is granted only by you.
- **Band** above the prompt, plain text that takes no keys, about your session's goal: `cc-huddle · meeting · 3 working · 1 needs you`, and under it a line for each task not yet done: its title and where it stands (`Rules · bob works on "Rolls", step 2 of 3`, `Board · "Grid" waits on "Rolls" by bob`), five of them, and how many more. A session without a goal has a band only when the repository has goals paused or running in other sessions: `cc-huddle · 2 goals paused`.
- A session without a goal has a pane that says so, and how to start one or take one up.
- **Asks**: what needs you, as it comes, in Claude Code's own question dialog (`$.ui.ask`), one at a time in the order it came, in the session that runs the goal, whether or not it is in a turn. A member's permission request offers allow once, allow always where Claude Code suggests a rule, and deny; an answer typed instead denies it with that note. A member's question is put as they asked it, one question after another, with what each option means; what you type that answers nothing leaves it in "Needs you", and a toast says so. A stuck review or a merge offers its decisions (§4.4), with the review's notes or the files that can't be merged; where a note goes with one, typed text is that note, and the pane offers the same as a note to type. A plan to review offers approve, approve and pick, and drop: picking is a second question, the tasks to tick, or with more than four, numbered for you to type which; typed text instead is the change you want, which goes to your session (§7.3). A task done that you accept offers accept, with each subtask's delivery and how to check it, and typed text sends it back with that as what to change. The mod asks and the mod answers: no model sees the dialog or the answer, so what Claude Code still asks after its own checks is answered by you. Dismissed, or "Chat about this", it stays open in "Needs you".
- **Transcript rows**, dim, for milestones (plan approved, subtask sent back, merged or failed, task done), so the conversation keeps a timeline without model turns. In a goal just taken up, those it had already are not news.
- **Without drawing** (`claude -p`, a terminal too narrow): `/huddle status` prints the same as text, and every record is a file in the data folder.

### 7.3 Your session

Your session talks; the pane shows and answers. `/huddle pause` pauses your session's goal, and `/huddle resume` resumes it, or takes up one of the repository's goals not running here (§3.2): the only one, or, with several, the one you pick in Claude Code's question dialog, each listed by name, how far it got, and whether it is paused, archived or running in another session (one this cc-huddle can't read by its folder and why, the rest listed all the same); more than the dialog's four are listed numbered, for `/huddle resume <number>`. While your session's goal is active, `/huddle resume` says to pause it first; with nothing under way, `/huddle pause` says so. `/huddle review`, `/huddle meeting` and `/huddle parallel` switch the team's settings (§6.1). None of these spends a model turn: they are certain. The tools your session has are all about its own goal, each described in its schema (`src/plugin/tools.ts`): where it stands and the repository's other goals (`status`); starting a goal with its meeting or its one member, refused while the session's goal is active (§3.2); the plan of its meeting; the goal's and its subtasks' lifecycles, as §4 has them; and carrying out your decisions. There is no tool to add a meeting or work to a goal under way, and none to message a member: what a member works from is their subtask's brief and the plan.

A tool that names a member (a meeting's attendees, an assignee, a plan's owners) takes only the goal's members, each listed with their role in its schema, so your session matches what you said against the team as it would against any tool's options. Before a goal, they list the team as its files have it. When the session starts or takes up a goal, the server tells Claude Code its tools changed (`notifications/tools/list_changed`).

Your session is woken only for what needs a model: a change you type to a plan, which it writes into the plan (`change_plan`); the changed plan is then asked again. The mod submits it to your session with `$.prompt.submit`, Claude Code's call for a plugin's prompt: an idle session starts a turn with it, read as a message from the cc-huddle plugin. Everything else that needs you is the mod's to ask (§7.2), so it spends no model turn; when you tell your session a decision in words instead, it carries it out with its tools. When you take a goal up, what waits in it is asked at once.

cc-huddle's prompts and tool results are in English, written for the model. What your session says to you stays in your language: the MCP server's instructions, which Claude Code gives your session every turn, tell it to talk to you in the language you write in, whatever cc-huddle's text is in.

## 8. Permissions

Members work under Claude Code's own permission modes and rules, set per team. Every member session also gets, as flag settings: cc-huddle disabled (`enabledPlugins`), so a member never starts a team of its own: the id read back from the data folder, which renames every character but letters, digits, `_` and `-` to `-`, and every `cc-huddle@…` your user and project settings name, since a marketplace's name may have a `.` that doesn't read back; `crossSessionInbound: refuse` and `SendMessage` and `ListAgents` denied, so members take no messages from your sessions and send none; and `--name huddle-<member>`, so a running member shows under its name in `claude agents`. Bare mode is not used: it would also drop the repository's `CLAUDE.md`. A member's turn runs in your session's permission mode, as you started it or switched it since (Shift+Tab): the mode of your last message, or of your session's last call to cc-huddle, one of which comes before any work starts (§3.3). So a session in `bypassPermissions` has members that ask nothing, and a session that asks has members that ask. A team whose `settings.json` sets `permissions.defaultMode` has its members in that mode instead. cc-huddle adds no permission default or sandbox of its own: a member loads your user and project settings as any session of yours does, so what Claude Code would let it do, or ask about, is what your settings say. A call Claude Code asks about becomes a permission request in "Needs you", and the member's turn waits for your answer: allow it once, deny it (with a note the member reads), or, where Claude Code suggests a rule for it, allow it always, which adds that rule to the repository's `settings.json` and the goal's copy (§6), so every member of the goal works under it from then on. Meetings, teammates' answers and reviews run read-only: the read-only tools, and no MCP server but the turn's own (`strictMcpConfig`). Yours would offer tools that do more than read; and a resumed session connects them partway through its turn, which changes its tools and writes the conversation's prompt cache again whole. In the first real meeting that cost the host 60k, 124k and 187k tokens of cache written on successive turns. Working sessions keep your MCP servers.

## 9. What it fixes

Each row names the tests that show it, under `src/engine/`. They run the engine against scripted SDK message streams or stubbed runs, with real git; none calls a model.

| Problem elsewhere                                                             | cc-huddle                                                                                                                    | Shown by                                                                                          |
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
- A member started with default options loads every enabled plugin, cc-huddle included, and has `SendMessage` and `ListAgents`; the flag settings in §8 remove both. Every member binds an inbox socket and is listed by `claude agents` as an interactive session, under its `--name`.

- An MCP server is not given `CLAUDE_PID` (hooks are); its parent process is the session. A command-form hook is the session's child too.
- A plugin's skill named like the plugin takes the plugin's name as its short command, `user-invocable: false` or not, and a mod's command of that name isn't registered; the skill is `team`.
- A plugin's `$.prompt.submit` from a `command.run` hook is refused, as it would wait on the command's own run; from a timer after it, it starts the turn. `/huddle <task>` so reaches the session, with the roster of a team kept only in `CLAUDE_CONFIG_DIR/huddle/`.
- `$.mcp.call` runs as a tool call: a PreToolUse and a PostToolUse hook in your settings run around each one (79 of each in 40 s of the pane's old 500 ms poll). `$.http.fetch` over a Unix socket runs none; the pane's poll there takes 1 to 4 ms.
- Claude Code refreshes a server's tools on `notifications/tools/list_changed`, so the member names in the tools follow the team as it is read.
- Loaded with `--plugin-dir` against the mock: the first start installs the dependencies and connects in about 5 s, later ones at once; the band, `/huddle`, `/huddle status`, the pane and the SessionStart context all show the team as its state file has it.

Left:

- Whether the pane redraws smoothly, polling its socket every 500 ms, while a meeting streams.
- Whether a member's session forked into a new worktree (§4.3) is found and reads its cache: Claude Code keeps sessions by working folder, and the cache lasts five minutes on an API key, an hour on a subscription within its usage, or as `CLAUDE_CODE_PROMPT_CACHE_TTL` in a member's `env` says. A fork's first turn shows which in `usage.cache_creation`.
- What sending a task back does to work already built on it. Today the subtask you pick goes on in its session; nothing else is told.

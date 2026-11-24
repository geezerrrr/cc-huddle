<h1 align="center">cc-huddle</h1>

<p align="center">
  <strong>Multi-agent orchestration for Claude Code.</strong>
</p>

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/geezerrrr/cc-huddle/actions/workflows/ci.yml"><img src="https://github.com/geezerrrr/cc-huddle/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-D97757" alt="Claude Code plugin">
</p>

cc-huddle is a Claude Code plugin that runs a team of agents on your repository. It drives each member through the Agent SDK, so every member is a native Claude Code session: its tool calls, permission requests and results reach cc-huddle as events, and nothing is read off a screen. The members meet to plan your task, build it in parallel and review each other's work. You approve the plan and the result, and your session stays free in the meantime.

<p align="center">
  <img src="docs/media/demo.gif" alt="cc-huddle: a team meets, plans and builds a feature in parallel, shown in its pane beside the Claude Code session" width="900">
</p>

> **Status: early (0.1).** Tested against scripted model streams and a few real runs. Expect rough edges, and please [report them](https://github.com/geezerrrr/cc-huddle/issues).

## Features

- **Native Claude Code.** Members run through the Agent SDK, not in terminal panes. Every tool call, permission request and result arrives as an event, permission prompts come to you as usual, and a member's session can always be resumed.
- **Process in code.** State machines decide what starts, what waits and what counts as done. The models only do the work.
- **One meeting to plan.** Each member first gives their own take without seeing the others', then they raise hands and the host gives the floor. The host writes the plan: tasks, owners, dependencies and acceptance criteria. You approve it, change it or drop it.
- **Parallel, isolated work.** Each subtask runs in its own session and git worktree, and starts once the work it depends on is merged.
- **Reviewed against the criteria.** Another member reviews each delivery against its acceptance criteria, and nothing else. A delivery that fails goes back to the same session with the notes. A member whose run fails keeps its session, so you can have it go on where it stopped.
- **Durable state.** State lives in files, not in a session's context. Close the terminal, and `/huddle resume` picks up where it stopped.
- **Small contexts.** Each subtask's session holds only its own part, so no context grows with the whole job. [One trial](docs/trial.md) compares a team with a single session on the same task.
- **Any model, one harness.** Each member runs on the model you choose, from any Anthropic-compatible provider, all inside Claude Code with your settings, permissions and CLAUDE.md.

## Install

Inside Claude Code:

```
/plugin marketplace add geezerrrr/cc-huddle
/plugin install cc-huddle@geezerrrr
```

Restart Claude Code afterwards. cc-huddle needs Claude Code 2.1.331 or later, Node.js 22.15 or later with npm on your `PATH`, and git. It installs its own dependencies with npm the first time it starts.

<details>
<summary>Other ways to install, update and uninstall</summary>

From a terminal:

```sh
claude plugin install cc-huddle --marketplace geezerrrr/cc-huddle
```

From a local clone:

```sh
git clone https://github.com/geezerrrr/cc-huddle.git
claude plugin marketplace add ./cc-huddle
claude plugin install cc-huddle@geezerrrr
```

Without installing, load the plugin from the clone: `claude --plugin-dir ./cc-huddle/plugin`. The built plugin is committed, so there is nothing to build.

Update with `claude plugin update cc-huddle@geezerrrr`. Uninstall with `claude plugin uninstall cc-huddle@geezerrrr`: this deletes the plugin's data folder, including its worktrees and any work not yet delivered. Merged work stays on the `huddle/*` branches, and `--keep-data` keeps the folder.

</details>

## Set up a team

A team is a `team.yaml` that lists its members. The first time it starts, cc-huddle writes a commented example to `~/.claude/huddle/team.yaml`. List your members there; a repository can add its own in `.claude/huddle/`.

```yaml
# ~/.claude/huddle/team.yaml
members:
  opus:
    role: developer
    model: opus
  sonnet:
    role: developer
    model: sonnet
  deepseek:
    role: developer
    env:
      ANTHROPIC_BASE_URL: https://api.deepseek.com/anthropic
      ANTHROPIC_AUTH_TOKEN: ${DEEPSEEK_API_KEY}
      ANTHROPIC_MODEL: deepseek-flash
```

A member without `env` runs on your own Claude Code sign-in; one on another provider gets that provider's variables. `${VAR}` is read from your environment, so keys stay out of the file. A role is just a name, and your team's principles for it can go in `roles/<role>.md`. Effort, permissions and full provider setups are in [docs/configuration.md](docs/configuration.md).

## Use it

Start Claude Code in a repository and give the team a task:

```
/huddle add Stripe subscriptions: checkout, webhooks and a billing page
```

1. **Start.** cc-huddle recommends the whole team or a single member, and says why. You choose; a single member skips the meeting.
2. **Plan.** The meeting runs in the background, and you can watch it in the pane. The plan then arrives in Claude Code's dialog: approve it, change it or drop it, and pick the tasks you want to accept yourself.
3. **Build.** Members work in parallel; a subtask starts once the work it depends on is merged. They ask each other questions, and ask you when only you can answer.
4. **Accept.** A task you picked comes back with what was done and how to check it.
5. **Merge.** Work collects on `huddle/<goal>/main`. When it is all done, the goal asks to merge into the branch it was cut from, then offers to remove its worktree and branch. cc-huddle never pushes.

| You type                          | What happens                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `/huddle <task>`                  | Gives the team a task, as a new goal                                              |
| `/huddle`                         | Opens the pane: the meeting, the team, what needs you                             |
| `/huddle status`                  | Prints where the session's goal stands                                            |
| `/huddle pause`, `/huddle resume` | Pauses the session's goal; resumes it, or picks up another goal in the repository |
| `/huddle review on\|off`          | Turns review of deliveries on or off                                              |
| `/huddle meeting <size>`          | Sets how long meetings run: `small`, `discussion` or `large`                      |
| `/huddle parallel on\|off`        | Lets a member do several pieces of work at once                                   |

You can also ask your session in plain words. A session runs one goal; for several at once, open several sessions.

## Cost and permissions

- **Tokens.** Each member's turn is its own Claude Code process on that member's provider, and several run at once. The pane shows each member's tokens. A member on another model can use far more tokens and take longer for the same work; that comes from the model, not from the scheduling.
- **Permissions.** Members work under your Claude Code settings and your session's permission mode, plus the team's `settings.json`. Meetings, reviews and answers to teammates are read-only. Details: [What runs, and what it may do](docs/configuration.md#what-runs-and-what-it-may-do).
- **Data.** Each goal's state, records and worktrees live in the plugin's data folder, outside your repository.

## Design notes

**When not to use it.** For one focused job, a single session or a subagent is cheaper and faster. cc-huddle is for work with several parts and dependencies.

**Why the Agent SDK.** A team can also be run by starting each CLI in a terminal pane, typing into it and reading its screen to tell whether it is ready, busy or done. That guess breaks easily, permission prompts get skipped because nothing can answer them, and a member that dies starts over. Through the Agent SDK, cc-huddle gets every step as an event, brings permission requests to you, and resumes a member's own session after a stop.

**One harness, many models.** This is our view from reviewing across tools, not a measurement. Every harness, whether Claude Code, Codex or Gemini CLI, has its own system prompt and agent loop, and so its own habits. A reviewer on a different harness objects to habits as well as to real faults, and some of its fixes make the work worse. Reviewing by hand, you filter: you take the findings back to the original tool and keep what it accepts. A team running on its own has nobody to filter, so every objection turns into rework. cc-huddle therefore varies the models, not the harness, and holds reviews to the acceptance criteria: a model asked only to find problems always finds more. If you see it differently, tell us in the [issues](https://github.com/geezerrrr/cc-huddle/issues).

The full design, state machines included, is in [docs/design.md](docs/design.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues: [SECURITY.md](SECURITY.md).

cc-huddle's engine comes from [Crewloft](https://playcrewloft.com), a game in which it runs a studio of AI staff.

## License

[MIT](LICENSE)

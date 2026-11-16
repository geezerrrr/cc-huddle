<h1 align="center">cc-huddle</h1>

<p align="center">
  <strong>Multi-agent orchestration for Claude Code.</strong><br>
  A team of Claude Code sessions on your repository: they meet, plan, work in parallel worktrees, review and merge their own work, and ask you only when something needs you.
</p>

<p align="center">
  <a href="https://github.com/geezerrrr/cc-huddle/actions/workflows/ci.yml"><img src="https://github.com/geezerrrr/cc-huddle/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-D97757" alt="Claude Code plugin">
</p>

<p align="center">
  <img src="docs/media/demo.gif" alt="cc-huddle: a team meets, plans and builds a dice game in parallel, shown in its pane beside the Claude Code session" width="900">
</p>

> **Early release (0.1).** Expect rough edges, and please [report them](https://github.com/geezerrrr/cc-huddle/issues).

## Why

One agent on a big task works in one long context that keeps growing, and does every step itself. Agent Teams and subagents hand the process to a lead model: it decides how many helpers, how to split the work and when it's done, and may well do it all itself.

cc-huddle keeps the process in code. State machines run the goal; models only do the work. Every subtask starts in a fresh session with just what it needs, on the model you chose for that member, in its own worktree, and nothing counts as done until it is reviewed and merged.

## Features

- **A meeting before the plan.** The members discuss the task; the host writes a plan of tasks with owners, dependencies and acceptance criteria. You approve it, change it or drop it.
- **Parallel work in git worktrees.** Each subtask runs in its own worktree, started as soon as what it depends on is merged and its owner is free.
- **Any model per member.** Sonnet on the code, GLM on the art, Opus reviewing: each member is a Claude Code session on any Anthropic-compatible API.
- **Review, then merge.** A reviewer passes each delivery or sends it back with notes. Merges go one at a time; a conflict goes back to its author to resolve.
- **Teammates talk.** A member can ask another while it works; you can message any member with `@name`.
- **You stay in charge.** Permission requests and members' questions wait for you, in Claude Code's own dialog or the pane. Your session's model can't answer them for you.
- **A live pane.** The meeting as it goes, each member at what they do, the record of anyone you follow, the tokens each has used, and what needs you.
- **Pause and resume.** Close the terminal and the goal pauses; `/huddle resume` goes on where it stopped, in the same sessions and worktrees.
- **Your branches stay yours.** Everything lands on `huddle/<goal>/main`. cc-huddle never pushes and never touches your working tree.

## Quick start

Requires Claude Code 2.1.322 or later, Node.js 22.15 or later with npm on your `PATH`, and git.

**1. Install** the plugin, in a terminal:

```sh
claude plugin install cc-huddle --marketplace geezerrrr/cc-huddle
```

**2. Write a team.** One role and two members is enough to start:

```sh
mkdir -p ~/.claude/huddle/roles ~/.claude/huddle/members
printf -- '---\ntitle: Developer\n---\n\nWrite the code for your subtask and its tests.\n' > ~/.claude/huddle/roles/developer.md
printf -- '---\nrole: developer\nmodel: sonnet\n---\n' > ~/.claude/huddle/members/sonnet.md
printf -- '---\nrole: developer\nmodel: opus\n---\n' > ~/.claude/huddle/members/opus.md
```

Members without `env` run on your own Claude Code sign-in. To put a member on another provider, see [Configuring a team](docs/configuration.md).

**3. Hand it a task.** Start Claude Code in a repository:

```
/huddle build a two-player dice game, opus on the rules, sonnet on the UI
```

Your session proposes a meeting (who attends, what each brings) or one member for a job that needs no planning, and asks you to start. The team then works in the background; your session stays free.

## How it works

<p align="center">
  <img src="docs/media/how-it-works.svg" alt="Task, meeting, plan you approve, parallel work, review (sent back with notes when it fails), merge into huddle/&lt;goal&gt;/main" width="900">
</p>

1. **Meeting.** The members you picked discuss the task in turns, read-only in the repository. The host writes the plan.
2. **Plan.** You approve it, change it or drop it, and choose which tasks you want to accept yourself.
3. **Work.** Each subtask starts in its own worktree once what it waits on is merged. Members ask each other when they need to.
4. **Review.** The meeting's host, or another member, judges each delivery against its acceptance criteria. A failed review sends it back with notes.
5. **Merge.** Passed work merges into the goal's branch, one subtask at a time. A task is done when its last subtask merges.

The full design, state machines included, is in [docs/design.md](docs/design.md).

<table>
  <tr>
    <td width="50%"><img src="docs/media/meeting.png" alt="The meeting tab: members speak in turn as the plan takes shape"></td>
    <td width="50%"><img src="docs/media/team.png" alt="The team tab: each member at what they do, and the tokens they've used"></td>
  </tr>
  <tr>
    <td align="center">The meeting, live</td>
    <td align="center">The team at work</td>
  </tr>
</table>

## Commands

| You type                               | What happens                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `/huddle <task>`                       | Hands the team a task                                                          |
| `/huddle`                              | Opens the pane: the meeting, the team, what needs you                          |
| `/huddle status`                       | Prints where the session's goal stands                                         |
| `/huddle pause`, `/huddle resume`      | Pauses the session's goal; resumes it, or takes up another of the repository's |
| `@sonnet put the scoreboard top right` | Passes a member a message, in their session                                    |

You can also just ask your session ("have opus do the scoreboard"). A session runs one goal; for more at once, run more sessions. The band above the prompt keeps count: `cc-huddle · meeting · 3 working · 1 needs you`.

## Compared with Agent Teams

|                      | Agent Teams                                                 | cc-huddle                                                                         |
| -------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Who runs the process | The lead model, from its prompt                             | State machines in code                                                            |
| Models               | Claude models, one provider                                 | Any model per member, any Anthropic-compatible provider                           |
| Planning             | A teammate drafts a plan; approved automatically by default | A meeting of the members; you approve the plan                                    |
| Isolation            | Shared working tree                                         | A git worktree per subtask, merged one at a time                                  |
| Done means           | A teammate marks the task complete                          | Delivered, reviewed, merged; sent back with notes when review fails               |
| Errors               | The teammate stops; spawn a replacement                     | Go on in the same session and worktree                                            |
| Closing the terminal | The team is gone                                            | Its goal pauses; take it up again with `/huddle resume` to go on where it stopped |

For one focused job, a subagent is cheaper and quicker. cc-huddle is for work with several people, steps and dependencies.

## FAQ

**What does it cost?** Each member's turn is a Claude Code process on that member's provider, so tokens are spent as they would be by a session of your own; several run at once. The pane shows how many each member has used.

**What may members do?** What your Claude Code settings allow, in your session's permission mode, plus the team's own `settings.json`. Meetings, reviews and answers to teammates are read-only. Anything Claude Code would ask about is asked of you. Details: [What runs, and what it may do](docs/configuration.md#what-runs-and-what-it-may-do).

**Where does the work go?** On `huddle/<goal>/main` in your repository, for you to review and merge. Worktrees, state and records live in the plugin's data folder, outside the repository.

**Does it need Agent Teams?** No. It uses only Claude Code's documented plugin and Agent SDK interfaces.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). cc-huddle's engine comes from [Crewloft](https://playcrewloft.com), a game in which it runs a studio of AI staff.

## License

[MIT](LICENSE)

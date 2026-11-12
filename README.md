# openplan

A team of Claude Code sessions on your repository. Each member has a role and any model with an Anthropic-compatible API. The team meets before it plans, works in parallel in its own worktrees, reviews and merges its own work, and asks you only when something needs you.

> **Status: early.** The engine is tested against scripted model streams, not yet run at length with real models; expect rough edges. [docs/design.md](docs/design.md) describes how it works.

## How it differs from Agent Teams

Agent Teams asks a lead model to run the process: how many teammates, how to split the work, when it's done. openplan keeps the process in code and leaves the models the work.

|                      | Agent Teams                                                 | openplan                                                             |
| -------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| Who runs the process | The lead model, from its prompt                             | State machines in code                                               |
| Models               | Claude models, one provider                                 | Any model per member, any Anthropic-compatible provider              |
| Planning             | A teammate drafts a plan; approved automatically by default | A meeting of the members; you approve the plan                       |
| Isolation            | Shared working tree                                         | A git worktree per subtask, merged one at a time                     |
| Done means           | A teammate marks the task complete                          | Delivered, reviewed, merged; sent back with notes when review fails  |
| Errors               | The teammate stops; spawn a replacement                     | Go on in the same session and worktree                               |
| Closing the terminal | The team is gone                                            | Goals pause; resume the session and a goal to go on where it stopped |

For one focused job, a subagent is cheaper and quicker. openplan is for work with several people, steps and dependencies.

## Requirements

- Claude Code 2.1.322 or later
- Node.js 22.15 or later, with npm, on your `PATH`: the plugin's MCP server and hook run on it, and its first start installs the server's dependencies
- git

## Install

In Claude Code:

```
/plugin install openplan --marketplace geezerrrr/openplan
```

## Set up a team

The team lives in `.claude/openplan/` in your repository, in files you write:

```
.claude/openplan/
  roles/developer.md
  roles/reviewer.md
  members/sonnet.md
  members/glm.md
  settings.json      optional
  team.json          optional
```

A role is its duties in Markdown, with a title:

```markdown
---
title: Developer
---

Write the code for your subtask and its tests. Keep to the repository's conventions.
```

A member is named by its file. It names its role, and optionally its model, effort and the environment its Claude Code runs with:

```markdown
---
role: developer
model: glm-5.3-flashx
effort: high
env:
  ANTHROPIC_BASE_URL: https://open.bigmodel.cn/api/anthropic
  ANTHROPIC_AUTH_TOKEN: ${GLM_API_KEY}
---
```

`${VAR}` and `${VAR:-default}` are filled in from the environment Claude Code runs in, so keys stay out of the files. A member without `env` runs on your own Claude Code sign-in.

`settings.json` is a Claude Code settings file every member works under: permission rules, the sandbox, anything Claude Code settings hold. `team.json` holds openplan's own:

```json
{ "review": true, "meetingSize": "discussion" }
```

`review` turns acceptance review on or off (on by default). `meetingSize` is `small`, `discussion` (the default) or `large`.

## Use it

Start Claude Code in the repository and say what you want:

- "Hold a meeting and build a two-player dice game."
- "Have glm do the scoreboard."
- "@sonnet put the scoreboard top right."

Your session hands the work to the team and returns at once. The members meet, and the host writes a plan of tasks with owners, dependencies and acceptance criteria. Your session shows you the plan and asks you to approve it, change it or drop it. Then the members work in parallel, each subtask in its own worktree, reviewed and merged into the goal's branch. A finished task waits for you to accept it.

- `/openplan` opens the pane: the meeting as it goes, each member at what they do (select one to follow their record), and what needs you, answered there with a button. Permissions are granted only there, by you.
- `/openplan status` prints where the team stands.
- The band above the prompt says what goes on: `openplan · meeting · 3 working · 1 needs you`.

The team runs while your session does. Closing the session pauses its goals; resume the session and a goal to go on where it stopped.

openplan works only on `openplan/*` branches: each goal has `openplan/<goal>/main`, yours to review and merge. It never pushes and never checks anything out in your working tree. Its state, records and worktrees are in the plugin's data folder, outside the repository.

## Development

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build        # bundles the MCP server and hook into plugin/dist, which is committed
pnpm check:mod    # validates the plugin and marketplace, and runs the mod's tests
```

`claude --plugin-dir plugin` starts a session with the plugin as it is in the working tree; the mod reloads as you edit it.

## Origin

openplan's engine comes from [Crewloft](https://playcrewloft.com), a game in which it runs a studio of AI staff.

## License

[MIT](LICENSE)

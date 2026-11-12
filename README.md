# openplan

A team of Claude Code sessions on your repository. Each member has a role and any model with an Anthropic-compatible API. The team meets before it plans, works in parallel in its own worktrees, reviews and merges its own work, and asks you only when something needs you.

> **Status: in development.** Nothing here runs yet. [docs/design.md](docs/design.md) describes what is being built.

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

- Claude Code 2.1.287 or later
- Node.js 24 or later
- git

## Development

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

## Origin

openplan's engine comes from [Crewloft](https://playcrewloft.com), a game in which it runs a studio of AI staff.

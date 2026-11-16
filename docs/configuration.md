# Configuring a team

A team is files you write: roles, members, and two optional settings files. How the engine reads them is in [design.md §6](design.md#6-team-configuration).

## Where the files go

```
~/.claude/huddle/          yours, for every repository
.claude/huddle/            one repository's, on top of yours
  roles/developer.md
  roles/reviewer.md
  members/sonnet.md
  members/glm.md
  settings.json            optional
  team.json                optional
```

Yours sits beside Claude Code's user settings (in `CLAUDE_CONFIG_DIR` when that is set). A repository's `.claude/huddle/` adds to yours: a role or member there replaces yours of the same name, and its `settings.json` and `team.json` go on top of yours.

## Roles

A role is its duties in Markdown, with a title:

```markdown
---
title: Developer
---

Write the code for your subtask and its tests. Keep to the repository's conventions.
```

## Members

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

- `model` is any model Claude Code can run, on any Anthropic-compatible API. Without it, the member uses Claude Code's default.
- `effort` is `low`, `medium`, `high`, `xhigh` or `max`.
- `env` is written as in `.mcp.json`: `${VAR}` and `${VAR:-default}` are filled in from the environment Claude Code runs in, so keys stay out of the files. A member without `env` runs on your own Claude Code sign-in.

A delivery is reviewed by the host of the meeting that planned it, else by the first other member in the list.

## `settings.json`

A Claude Code settings file every member works under: permission rules, the sandbox, anything Claude Code settings hold.

## `team.json`

cc-huddle's own settings:

```json
{ "review": true, "meetingSize": "discussion" }
```

- `review` turns acceptance review on or off (on by default).
- `meetingSize` is `small`, `discussion` (the default) or `large`.

## What runs, and what it may do

- **Processes and tokens.** Each member's turn is a Claude Code process of its own, started by the plugin's MCP server: one per running subtask, review and meeting turn, several at once. Each uses tokens on its member's provider; the pane shows how many each member has used.
- **Settings.** A member loads your user and project Claude Code settings, as any session of yours does, with the team's `settings.json` and its own `env` on top. Meetings, answers to teammates and reviews run read-only, with none of your MCP servers. Working, a member is in your session's permission mode, switched with it, unless `settings.json` sets `permissions.defaultMode`; cc-huddle adds no default of its own. A call Claude Code asks about is put to you at once in Claude Code's own question dialog, and waits in the pane if you dismiss it. Members leave committing to delivery.
- **Who answers.** Permissions and members' questions are answered in the pane, by you: the plugin keeps your session's model from the pane's tools. That guard is one of the plugin's hooks, so where `allowManagedHooksOnly` keeps a user's plugins from loading hooks, install cc-huddle as a managed plugin. `claude -p` draws no pane: what needs you waits for an interactive session.
- **Git.** cc-huddle works only on `huddle/*` branches: each goal has `huddle/<goal>/main`, yours to review and merge. It never pushes and never checks anything out in your working tree. Each goal's state, its copy of the team, its records and its worktrees are in the plugin's data folder, outside the repository.
- **Uninstalling** removes the plugin's data folder, worktrees included, and with them any work a member hasn't delivered. Delivered work stays on the `huddle/*` branches. `claude plugin uninstall cc-huddle@geezerrrr --keep-data` keeps the folder.

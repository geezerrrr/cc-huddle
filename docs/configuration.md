# Configuring a team

A team is three things: the members and the team's settings, in `team.yaml`; their roles, as Markdown files; and the Claude Code settings they all work under. How the engine reads them is in [design.md §6](design.md#6-team-configuration).

## Where the files go

```
~/.claude/huddle/          yours, for every repository
.claude/huddle/            one repository's, on top of yours
  team.yaml
  roles/developer.md
  settings.json
```

Yours sits beside Claude Code's user settings (in `CLAUDE_CONFIG_DIR` when that is set). cc-huddle writes each of the three files there that is missing as a session starts, as examples explained in comments, and never touches one that is there. A repository's `.claude/huddle/` adds to yours: a member, role or team setting there replaces yours, and its `settings.json` goes on top of yours.

## `team.yaml`

Each member by name, with its role:

```yaml
members:
  sonnet:
    role: developer
    model: sonnet
  deepseek:
    role: designer
    effort: high
    env:
      ANTHROPIC_BASE_URL: https://api.deepseek.com/anthropic
      ANTHROPIC_AUTH_TOKEN: ${DEEPSEEK_API_KEY}
      ANTHROPIC_MODEL: deepseek-flash
    settings:
      permissions:
        deny: ["Bash"]
```

- `role` names a file in `roles/`. A role with no file is just its name, with no duties.
- `model` is any model Claude Code can run. Without it, the member uses Claude Code's default, or `ANTHROPIC_MODEL` from its `env`.
- `effort` is `low`, `medium`, `high`, `xhigh` or `max`.
- `env` takes any environment variable Claude Code reads, written as in `.mcp.json`: `${VAR}` and `${VAR:-default}` are filled in from the environment Claude Code runs in, so keys stay out of the files. A member without `env` runs on your own Claude Code sign-in.
- `settings` are Claude Code settings for this member alone, over the team's `settings.json`.

A provider's recommended setup for Claude Code goes in `env` as it is. DeepSeek's, for one:

```yaml
members:
  deepseek:
    role: developer
    env:
      ANTHROPIC_BASE_URL: https://api.deepseek.com/anthropic
      ANTHROPIC_AUTH_TOKEN: ${DEEPSEEK_API_KEY}
      ANTHROPIC_MODEL: deepseek-flash[1m]
      ANTHROPIC_DEFAULT_OPUS_MODEL: deepseek-flash[1m]
      ANTHROPIC_DEFAULT_SONNET_MODEL: deepseek-flash[1m]
      ANTHROPIC_DEFAULT_HAIKU_MODEL: deepseek-flash
      CLAUDE_CODE_SUBAGENT_MODEL: deepseek-flash
      CLAUDE_CODE_EFFORT_LEVEL: max
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: 786432
```

## Roles

A role is a name: the angle its members see the work from. cc-huddle ships none. A role may have a Markdown file, named by it, for the principles your team keeps in that role, which every member in it reads; comments in it aren't read. A `title` in front matter names it on screen, the file's name when there is none:

```markdown
---
title: Developer
---

Keep to the repository's conventions. Never change a public API without saying so in your handover.
```

A role with no file is its name alone. What the whole team works by belongs in the repository's `CLAUDE.md`.

## `settings.json`

A Claude Code settings file every member works under: permission rules, the sandbox, anything Claude Code settings hold. When you allow a member's request always, cc-huddle adds the rule here, in the repository's.

## Team settings

Three settings in `team.yaml`, beside `members`; the repository's file overrides yours:

```yaml
review: true # another member reviews each delivery before it merges
meeting: discussion # how long meetings' discussions run: small, discussion or large
parallel: false # whether a member does several pieces of work at once
```

Switch them as you switch `/model`: `/huddle review on|off`, `/huddle meeting small|discussion|large`, `/huddle parallel on|off`, or with no value, picked in a dialog. A switch writes your `team.yaml`, keeping its comments, and applies to your session's goal and the goals you start after; goals already started elsewhere keep theirs. Where the repository's `team.yaml` sets one, the command says to change it there.

## What runs, and what it may do

- **Processes and tokens.** Each member's turn is a Claude Code process of its own, started by the plugin's MCP server: one per running subtask, review and meeting turn, several at once. Each uses tokens on its member's provider; the pane shows how many each member has used.
- **Settings.** A member loads your user and project Claude Code settings, as any session of yours does, with the team's `settings.json`, then its own `settings` and `env`, on top. Meetings, answers to teammates and reviews run read-only, with none of your MCP servers. Working, a member is in your session's permission mode, switched with it, unless `settings.json` sets `permissions.defaultMode`; cc-huddle adds no default of its own. A call Claude Code asks about is put to you at once in Claude Code's own question dialog, and waits in the pane if you dismiss it. Members commit their own work; a delivery is what they committed.
- **Who answers.** Plans, finished tasks you accept, permissions and members' questions are answered in Claude Code's dialog or the pane, by you: the plugin keeps your session's model from the pane's tools. That guard is one of the plugin's hooks, so where `allowManagedHooksOnly` keeps a user's plugins from loading hooks, install cc-huddle as a managed plugin. `claude -p` draws no pane: what needs you waits for an interactive session.
- **Git.** cc-huddle works on `huddle/*` branches: each goal has `huddle/<goal>/main`, cut from the branch you are on. Once the goal's work is done and you say merge, your branch fast-forwards to it, a member first merging in, in the goal's worktree, whatever your branch gained meanwhile; changes of yours in the way stop it, saying why. It never pushes. Each goal's state, its copy of the team, its records and its worktrees are in the plugin's data folder, outside the repository.
- **Uninstalling** removes the plugin's data folder, worktrees included, and with them any work a member hasn't delivered. Delivered work stays on the `huddle/*` branches. `claude plugin uninstall cc-huddle@geezerrrr --keep-data` keeps the folder.

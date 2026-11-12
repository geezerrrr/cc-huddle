# Changelog

All notable changes to openplan are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A team of Claude Code sessions on your repository, set up in `~/.claude/openplan/` for all your repositories and in a repository's `.claude/openplan/` on top: roles, members with any model on an Anthropic-compatible API, Claude Code settings for all of them, and openplan's own.
- Planning meetings: the host opens, members raise hands and are given the floor, and the host writes a plan of tasks and subtasks for you to approve, change or cancel.
- Work in parallel, each subtask in its own git worktree, reviewed and merged into the goal's `openplan/<goal>/main` branch; a failed review or a text conflict goes back to its member.
- A pane (`/openplan`) with the meeting, each member's record as it grows, and what needs you, answered with a button; a band above the prompt; `/openplan status`.
- Your session's tools for goals, meetings, plans, subtasks and decisions, and a skill that keeps it to relaying.

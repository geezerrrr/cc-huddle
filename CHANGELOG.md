# Changelog

All notable changes to cc-huddle are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A team of Claude Code sessions on your repository, set up in `~/.claude/huddle/` for all your repositories and in a repository's `.claude/huddle/` on top: members in `team.yaml`, each with any model and environment Claude Code takes and settings of its own, roles as Markdown, and Claude Code settings for all of them.
- Planning meetings: the host opens, members raise hands and are given the floor, and the host writes a plan of tasks and subtasks for you to approve, change or cancel.
- Work in parallel, each subtask in its own git worktree, reviewed and merged into the goal's `huddle/<goal>/main` branch; a failed review or a text conflict goes back to its member.
- `/huddle <task>` hands the team a task in your own words; your session proposes who takes it, a meeting or one member, and starts once you agree.
- A pane (`/huddle`) with the meeting, each member's record as it grows, and what needs you, answered with a button; a band above the prompt; `/huddle status`; `/huddle review` and `/huddle meeting` switch review and the meeting size as `/model` switches the model.
- Your session's tools for goals, meetings, plans, subtasks and decisions, and a skill that keeps it to relaying.

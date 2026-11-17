# Changelog

All notable changes to cc-huddle are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-17

### Added

- A team of Claude Code sessions on your repository, set up in `~/.claude/huddle/` for all your repositories and in a repository's `.claude/huddle/` on top: members in `team.yaml`, each with any model and environment Claude Code takes and settings of its own, roles as Markdown, and Claude Code settings for all of them.
- Planning meetings: the host opens, members raise hands and are given the floor, and the host writes a plan of tasks and subtasks for you to approve, change or cancel.
- Work in parallel, each subtask in its own git worktree, reviewed and merged into the goal's `huddle/<goal>/main` branch; a failed review or a text conflict goes back to its member.
- `/huddle <task>` hands the team a task in your own words, as a goal of its own; your session proposes who takes part, and starts once you agree: one member takes it, several meet and plan it. A goal is planned once; when its work is done it asks to merge its branch back into the one it was cut from (accept the last task and merge in one go), a member resolving any conflicts, then closes and offers to clean up.
- A pane (`/huddle`) with the meeting, each member's record as it grows, and what needs you, answered with a button; plans and tasks you accept are asked in Claude Code's dialog, with no turn of your session's model, and a task you accept says what was done and how to check it; a band above the prompt; `/huddle status`; `/huddle review`, `/huddle meeting` and `/huddle parallel` switch the team's settings in `team.yaml` as `/model` switches the model.
- Your session's tools for goals, meetings, plans, subtasks and decisions, and a skill that keeps it to relaying.
- Example team files written to `~/.claude/huddle/` where missing, explained in comments; no built-in roles.
- A member's subtask that builds on their own merged work forks that work's session, in a new worktree.

[Unreleased]: https://github.com/geezerrrr/cc-huddle/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/geezerrrr/cc-huddle/releases/tag/v0.1.0

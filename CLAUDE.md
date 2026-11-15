# openplan

How openplan behaves is `docs/design.md`: change it first, then the code. This file is how the code is written: the rules a change keeps and a review checks. A review reports what breaks a rule here, and nothing else; a rule that turns out wrong is changed here first.

## Checks

`pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test`, `pnpm check:mod` before every commit; `pnpm build` writes `plugin/dist/`, committed on its own (`build: plugin dist`).

## Layers and what may import what

- `src/shared/`: leaves any part uses (errors, whole-file writes and reads, pids, serial queues, text). They import nothing of openplan's.
- `src/engine/`: knows nothing of Claude Code's interface or of the plugin. Its modules import `src/shared/` and each other, never `src/plugin/`.
- `src/plugin/`: imports the engine only from `src/engine/index.ts`, the engine's one public surface, and `src/shared/`. Lint enforces it.
- `plugin/hooks/` (the mod): runs in Claude Code, imports `claude-code`, its own files and the types in `plugin/types/`; never `src/`.
- A module imports only what its own job needs. No module imports another's internals to rebuild what that module could give.

## State

- Every status is in a machine table in `src/engine/machines.ts` and moves only through `step`, by its one owner module. A state that behaves differently is a status of its own or a row of its own, not a field beside the status that changes what an event does.
- Each part of `GoalState` has one owner module that changes it; others read it.
- `GoalState` holds only what must outlive the process. What is under way now (a run, a review, a merge, who speaks at a meeting) lives in its owner's memory and reaches the rules through `Work`.
- Nothing derived is stored: what waits on what, who is busy, what can be done, what was accepted are functions in `src/engine/derive.ts`. The scheduler starts exactly what derive leaves waiting on nothing, and orders nothing itself.
- A stored shape that changes bumps `STATE_VERSION`.

## Modules

- One job per module, said in its header. A module that grows a second job is split along that seam.
- A function says its job in its name and does that one job; a method that needs nested closures to read is a class or a module of its own.
- Paths in the data folder are named in `src/shared/layout.ts` only.
- Agent SDK options are composed in `src/engine/policy.ts` only; a turn adds only its own `resume`, `canUseTool` and turn server, through `turns.ts`.
- What a format is written as and read back from (a plan, the state) is in one module, both ways.

## Words

- What a member's model reads: `src/engine/prompts.ts` only.
- What your session's model reads and what you read: `src/plugin/words.ts` holds each thing said in more than one place; a sentence said once stays with what assembles it (`status.ts`, `pane.ts`, `tools.ts`). Code never compares words: it compares kinds, and words are made from kinds.
- The mod's own words are only its controls and labels, its tabs' empty states, and what it says before the server answers or when a call fails. Everything about the team is the server's, served as sentences: the mod draws, it doesn't compose.
- What your session's skill says is not repeated in a prompt to it: a prompt gives the facts and ids, and points to the skill.

## Contracts

- The view the mod draws and everything the mod sends are types in `plugin/types/index.d.ts`, both ways; the server's zod schemas satisfy them.
- A rule lives on one side of the socket: the server decides, the mod draws and passes on presses. The mod keeps only what drawing needs.

## Code

- No code nobody needs: no unread field, no option nobody passes, no guard the types or the entry already exclude, no wrapper that only renames.
- Input is checked once, where it enters (a tool's schema, the view's schema, a file's read).
- An error is caught only where it is expected, by its kind (`ENOENT`, `GitError`); anything else goes on up.
- The same logic is written once. A second use moves it where both can reach.
- Types say the invariant: a field always set is required, alternatives are a discriminated union, one fact is stored once.
- Comments say why, in the code's own terms; a comment that no longer matches is a bug.
- Commits: one-line conventional messages, small.

# cc-huddle

cc-huddle is a Claude Code plugin that runs a team of Claude Code sessions on a repository. It has three parts: the engine (`src/engine/`, state machines and the members' sessions, public surface `src/engine/index.ts`), the plugin's MCP server and hook (`src/plugin/`), and the mod that draws the pane inside Claude Code (`plugin/hooks/`).

How cc-huddle behaves is `docs/design.md`: change it first, then the code. This file is how the code is written: the rules a change keeps and a review checks. A review reports what breaks a rule here, and nothing else; a rule that turns out wrong is changed here first.

## Development

- Node.js and pnpm at the versions in `mise.toml`, then `pnpm install`. `claude --plugin-dir plugin` starts a session with the plugin as it is in the working tree.
- The mod's types (`plugin/tsconfig.json` and `plugin/.claude-plugin/types/`, both git-ignored) are written when an interactive Claude Code session loads the plugin. Until one has, `pnpm lint` fails in `plugin/hooks/`. CI lints all but the mod for this reason.
- CI runs the tests on Linux, macOS and Windows, so code and tests hold on all three: paths through `path` and `pathToFileURL`, never joined with `/` or imported as bare absolute paths; no reliance on signals or on line endings (git on Windows checks text out with CRLF unless told otherwise; `vitest.config.js` turns that off for the tests).

## Checks

`pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm test`, `pnpm check:mod` before every commit. `pnpm build` writes `plugin/dist/`, which is committed on its own (`build: plugin dist`).

## Layers and what may import what

- `src/shared/`: leaves any part uses (errors, whole-file writes and reads, pids, serial queues, text). They import nothing of cc-huddle's.
- `src/engine/`: knows nothing of Claude Code's interface or of the plugin. Its modules import `src/shared/` and each other, never `src/plugin/`.
- `src/plugin/`: imports the engine only from `src/engine/index.ts`, and `src/shared/`; its tests may set work up through the engine's own modules. Lint enforces it.
- `plugin/hooks/` (the mod): runs in Claude Code, imports `claude-code`, its own files and the types in `plugin/types/`, never `src/`.
- The mod's state atoms are declared, read and changed in `state.ts` only, each inside a function declaration. Claude Code's state scan finds an atom only in the file that declares it, and follows `$` into another file only through a function declaration.
- A module imports only what its own job needs. No module imports another's internals to rebuild what that module could give.

## State

- Every status is in a machine table in `src/engine/machines.ts` and moves only through `step`, by its one owner module. A state that behaves differently is a status or a row of its own, not a field beside the status that changes what an event does.
- Each part of `GoalState` has one owner module that changes it; others read it.
- `GoalState` holds only what must outlive the process. What is under way now (a run, a review, a merge, who speaks at a meeting) lives in its owner's memory and reaches the rules through `Work`.
- Nothing derived is stored. What waits on what, who is busy, what can be done and what was accepted are functions in `src/engine/derive.ts`. The scheduler starts exactly what derive leaves waiting on nothing, and orders nothing itself.
- A stored shape that changes bumps `STATE_VERSION`.

## Modules

- One job per module, said in its header. A module that grows a second job is split along that seam.
- A function's name says its one job. A method that needs nested closures to read clearly becomes a class or a module of its own.
- The data folder's folders and a goal's files are named in `src/shared/layout.ts`. A file name that only one module writes and reads stays in that module.
- Agent SDK options are composed in `src/engine/policy.ts` only. A turn adds only what is its own: `resume`, `canUseTool`, its turn server (`turnServer` in `turns.ts`) and the tools it allows, an output schema, the abort, and the Claude Code process it runs under.
- A format that is written and read back (a plan, the state) lives in one module, both ways.

## Words

- What a member's model reads is in `src/engine/prompts.ts` only.
- What your session's model and you read: a sentence made from a kind (a status, a wait, a need, where a goal is) is in `src/plugin/words.ts`, wherever it is said. Any other sentence stays in the module that assembles it (`status.ts`, `pane.ts`, `tools.ts`), even when a similar one is said elsewhere.
- Code compares kinds, never words.
- The mod writes only its own controls and labels, its tabs' empty states, the `/huddle resume`, `review` and `meeting` dialogs, what it shows before the server answers or when a call fails, and its reactions to its own dialogs. Everything about the team comes from the server as finished sentences: the mod draws, it doesn't compose.
- A prompt to your session gives the facts and ids and points to the skill. It doesn't repeat what the skill says.

## Contracts

- The view the mod draws and everything the mod sends are types in `plugin/types/index.d.ts`, both ways; the server's zod schemas satisfy them.
- A rule lives on one side of the socket: the server decides, the mod draws and passes on presses. The mod keeps only what drawing needs.

## Code

- No code nobody needs: no unread field, no option nobody passes, no guard the types or the entry already exclude, no wrapper that only renames.
- Input is checked once, where it enters (a tool's schema, the view's schema, a file's read).
- An error is caught only where it is expected, by its kind (`ENOENT`, `GitError`); anything else goes on up.
- The same logic is written once. A second use moves it where both can reach.
- Types say the invariant: a field always set is required, alternatives are a discriminated union, one fact is stored once. When a machine moves a record in place and a field is set only in some statuses, the field stays optional and is asserted once, where a status needs it.
- Comments say why, in the code's own terms. A comment that no longer matches the code is a bug.

## Commits and pull requests

- One-line conventional messages, small commits. No `Co-Authored-By` or "Generated with" lines.
- A pull request does one thing. A change in behaviour updates `docs/design.md` in the same pull request, and comes with tests.
- Open an issue before a large change, so the design is agreed before the code.

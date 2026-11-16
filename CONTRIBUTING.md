# Contributing

Issues and pull requests are welcome. For a bug, the [issue form](https://github.com/geezerrrr/cc-huddle/issues/new/choose) asks for the versions and the lines of `claude --debug` that help; for a security issue, see [SECURITY.md](SECURITY.md).

How cc-huddle behaves is [docs/design.md](docs/design.md): a change in behaviour changes it first. How the code is written, and what a review checks, is [CLAUDE.md](CLAUDE.md).

## Development

Node.js and pnpm at the versions in `mise.toml`.

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

## Releasing

Move what [CHANGELOG.md](CHANGELOG.md) lists under Unreleased to a new version, set the same `version` in `plugin/.claude-plugin/plugin.json` (installs update when it changes), commit, and push a `v<version>` tag.

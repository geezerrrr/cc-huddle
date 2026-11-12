/**
 * Builds what the plugin runs into `dist/`, which is committed: a plugin is
 * installed as its repository is, with no build step.
 *
 * - `server.mjs`: the MCP server. Our code, with the dependencies the Agent
 *   SDK shares left out: the SDK isn't ours to ship, so these are installed
 *   from npm on first start (src/plugin/bootstrap.ts), as `package.json`
 *   here names them, at the versions this repository locks.
 * - `session-start.mjs`: the SessionStart hook, whole.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import { build } from "esbuild";

/** Installed on first start; everything else is in the bundle. */
const INSTALLED = ["@anthropic-ai/claude-agent-sdk", "@modelcontextprotocol/sdk", "zod"];

const common = {
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Dependencies written as CommonJS still call require.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  logLevel: "warning",
};

await rm("dist", { recursive: true, force: true });
await build({
  ...common,
  entryPoints: [{ in: "src/plugin/bootstrap.ts", out: "server" }],
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  external: INSTALLED,
});
await build({ ...common, entryPoints: ["src/plugin/session-start.ts"] });

const version = async (name) =>
  JSON.parse(await readFile(`node_modules/${name}/package.json`, "utf8")).version;
const dependencies = Object.fromEntries(
  await Promise.all(INSTALLED.map(async (name) => [name, await version(name)])),
);
await writeFile(
  "dist/package.json",
  `${JSON.stringify({ private: true, type: "module", dependencies }, null, 2)}\n`,
);

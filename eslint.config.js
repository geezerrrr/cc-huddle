import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["plugin/dist", "plugin/.claude-plugin/types"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
  // The layers (CLAUDE.md): shared leaves, an engine that knows nothing of the plugin, and a plugin that reaches it through its public surface.
  {
    files: ["src/shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["../*/*"], message: "src/shared imports nothing of openplan's." }] },
      ],
    },
  },
  {
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["../plugin/*"], message: "The engine knows nothing of the plugin." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/plugin/**/*.ts"],
    ignores: ["src/plugin/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../engine/*", "!../engine/index.ts"],
              message: "The plugin imports the engine from src/engine/index.ts only.",
            },
          ],
        },
      ],
    },
  },
  // The mod runs in Claude Code, not Node: `pnpm check:mod` checks it there.
  { files: ["plugin/**/*.tsx"], ...tseslint.configs.disableTypeChecked },
);

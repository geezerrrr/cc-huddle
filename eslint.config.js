import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["plugin/dist"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
  // The mod runs in Claude Code, not Node: `pnpm check:mod` checks it there.
  { files: ["plugin/**/*.tsx"], ...tseslint.configs.disableTypeChecked },
);

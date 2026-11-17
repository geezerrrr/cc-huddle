import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Git and Node start several times slower on Windows; a test here waits on many of both.
    testTimeout: 60_000,
    // Tests read back what git checked out byte for byte; git on Windows turns line endings into CRLF by default.
    env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.autocrlf", GIT_CONFIG_VALUE_0: "false" },
  },
});

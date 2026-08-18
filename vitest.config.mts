import { defineConfig } from "vitest/config";

export default defineConfig({
  // Never load the deployment's private `.env` while running tests. Every
  // authentication test supplies explicit, non-secret environment values.
  envDir: new URL("./tests/vitest-env", import.meta.url).pathname,
  test: {
    environment: "node",
    coverage: {
      reporter: ["text", "html"],
    },
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});

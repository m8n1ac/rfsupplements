import { defineConfig } from "vitest/config";

// Unit tests only. The Playwright suite lives in tests/e2e and runs separately.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // src/lib/env.ts validates at import and throws if anything is missing, so
    // even pure unit tests need the real .env loaded.
    setupFiles: ["dotenv/config"],
  },
});

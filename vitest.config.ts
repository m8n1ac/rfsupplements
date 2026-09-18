import { defineConfig } from "vitest/config";

// Unit tests only. The Playwright suite lives in tests/e2e and runs separately.
//
// server-only resolves to an empty module under the react-server condition, so
// these tests can import server modules directly while the guard still holds
// for the application bundle. Vitest resolves through Vite's SSR pipeline, so
// the condition has to be set there as well as on resolve.
export default defineConfig({
  resolve: { tsconfigPaths: true, conditions: ["react-server", "node"] },
  ssr: { resolve: { conditions: ["react-server", "node"] } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    // setup-db.ts must come after dotenv so it wins: these tests must never
    // touch the live database.
    setupFiles: ["dotenv/config", "./tests/unit/setup-db.ts"],
  },
});

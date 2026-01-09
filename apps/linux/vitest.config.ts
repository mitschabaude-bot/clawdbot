import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
    pool: "forks", // Better isolation for tests that mock modules
    globals: false,
  },
});

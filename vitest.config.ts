import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: [
        // Type-only modules erase at compile time, so they report 0% and skew the totals.
        "src/**/types.ts",
        "src/index.ts",
      ],
      // Set just below the measured baseline: these are a ratchet against
      // regression, not a target. Raise them when coverage genuinely improves.
      thresholds: {
        statements: 78,
        branches: 75,
        functions: 85,
        lines: 78,
      },
    },
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Real-browser tests live in tests/browser and run via `npm run test:browser`.
    // The default suite must stay offline and browser-free.
    exclude: ["tests/browser/**", "node_modules/**", "dist/**"],
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
      //
      // Recalibrated for vitest 4's coverage-v8, which counts statements and
      // branches differently from the v3 engine these were first measured
      // against (AST-based instrumentation instead of istanbul's, a smaller
      // and different unit count for the same source). The drop in these
      // numbers versus earlier commits is a measurement-methodology change,
      // not a real loss of test coverage — the same 233 tests pass.
      thresholds: {
        statements: 74,
        branches: 62,
        functions: 78,
        lines: 75,
      },
    },
  },
});

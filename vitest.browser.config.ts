import { defineConfig } from "vitest/config";

/**
 * Real-browser integration tests, kept out of the default suite on purpose.
 *
 * `npm test` must stay offline, browser-free and fast — that constraint is
 * what makes it usable as a CI gate. These tests need Chromium and a
 * loopback HTTP server, so they run separately via `npm run test:browser`.
 */
export default defineConfig({
  test: {
    include: ["tests/browser/**/*.test.ts"],
    environment: "node",
    // Launching a browser and driving a full session is slow; the offline
    // suite's 20s budget does not apply here.
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // One browser at a time keeps CI memory predictable.
    fileParallelism: false,
  },
});

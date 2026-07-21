/**
 * Real browser run against a live site with Playwright.
 *
 *   npm install playwright && npx playwright install chromium
 *   npx tsx examples/real-browser.ts https://your-app.example.com
 */
import { EveSession, PlaywrightAdapter, writeReports } from "../src/index.js";
import { AccessibilityPlugin, PerformancePlugin } from "../src/index.js";

const url = process.argv[2];
if (!url) {
  console.error("Usage: npx tsx examples/real-browser.ts <url>");
  process.exit(2);
}

const session = new EveSession({
  adapter: new PlaywrightAdapter({ headless: true }),
  startUrl: url,
  persona: "impatient-user",
  goal: "figure out what this product does and how to get started",
  maxSteps: 40,
  maxDurationMs: 5 * 60 * 1000,
  screenshots: true,
  plugins: [new AccessibilityPlugin(), new PerformancePlugin()],
  onLog: (line) => console.log(`  ${line}`),
});

const result = await session.run();
const written = await writeReports(result, ".eve-output/real-browser");
console.log(`\nDone: ${result.endReason}. Open ${written.html}`);

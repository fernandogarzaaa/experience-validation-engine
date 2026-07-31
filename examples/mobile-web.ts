/**
 * Mobile web run: touch actuation, device emulation, and the mobile-specific
 * accessibility findings (tap-target size, keyboard occlusion, hover-only
 * affordances) against a live site.
 *
 *   npm install playwright && npx playwright install chromium
 *   npx tsx examples/mobile-web.ts https://your-app.example.com ["iPhone 14"]
 */
import { AccessibilityPlugin, EveSession, MobileAdapter, writeReports } from "../src/index.js";

const url = process.argv[2];
const device = process.argv[3] ?? "iPhone 14";
if (!url) {
  console.error('Usage: npx tsx examples/mobile-web.ts <url> ["device name"]');
  process.exit(2);
}

const session = new EveSession({
  adapter: new MobileAdapter({ headless: true, device }),
  startUrl: url,
  persona: "impatient-user",
  goal: "figure out what this product does and how to get started",
  maxSteps: 40,
  maxDurationMs: 5 * 60 * 1000,
  screenshots: true,
  plugins: [new AccessibilityPlugin()],
  onLog: (line) => console.log(`  ${line}`),
});

const result = await session.run();
const written = await writeReports(result, ".eve-output/mobile-web");

const touchFindings = result.findings.filter((f) =>
  ["tap target", "keyboard", "Hover-only"].some((needle) => f.title.includes(needle)),
);
console.log(`\nDone: ${result.endReason}. Open ${written.html}`);
if (touchFindings.length > 0) {
  console.log(`\nTouch-specific findings (${touchFindings.length}):`);
  for (const f of touchFindings) console.log(`  [${f.severity}] ${f.title}`);
}

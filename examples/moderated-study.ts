/**
 * Phase 3 — AI-moderated user study.
 *
 * After a population study, convene a panel of specialist AI researchers —
 * UX Researcher, Interaction Designer, Accessibility Specialist, QA Engineer,
 * Behavioral Psychologist, Product Manager — who each analyze the population
 * from their own lens. A moderator then synthesizes their independent reports
 * into one executive report: a release verdict, the panel's consensus and
 * conflicts, and a prioritized recommendation list.
 *
 * Run:
 *   npx tsx examples/moderated-study.ts
 */

import { simulatePopulation } from "../src/population/index.js";
import { moderateStudy, renderModeratedStudyMarkdown } from "../src/study/index.js";

const study = await simulatePopulation({
  url: "mock:",
  size: 30,
  seed: 7,
  concurrency: 8,
});

const report = moderateStudy(study);

process.stdout.write(`${renderModeratedStudyMarkdown(report)}\n`);

process.stdout.write(
  `\nVERDICT: ${report.verdict.toUpperCase()} ` +
    `(panel confidence ${Math.round(report.confidence * 100)}%)\n`,
);
for (const s of report.specialists) {
  process.stdout.write(`  ${s.role.padEnd(26)} ${s.stance}\n`);
}

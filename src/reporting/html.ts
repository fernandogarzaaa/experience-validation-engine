import type { Finding } from "../core/types.js";
import type { EmotionSample } from "../emotion/emotionalState.js";
import type { ExperienceReport } from "./report.js";

/**
 * Self-contained HTML report: no external assets, screenshots inlined as
 * data URIs, timelines and heatmap rendered as inline SVG.
 */
export function renderHtml(report: ExperienceReport): string {
  const { result } = report;
  const critical = result.findings.filter((f) => f.severity === "critical");
  const major = result.findings.filter((f) => f.severity === "major");
  const minor = result.findings.filter((f) => f.severity === "minor");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Experience Report — ${escapeHtml(result.startUrl)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; background: #f5f6f8; color: #1e2430; line-height: 1.55; }
  main { max-width: 980px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 20px; margin: 40px 0 12px; border-bottom: 2px solid #e2e5ea; padding-bottom: 6px; }
  h3 { font-size: 15px; margin: 18px 0 6px; }
  .meta { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
  .summary { background: #fff; border: 1px solid #e2e5ea; border-radius: 10px; padding: 18px 20px; font-size: 15px; }
  .score-hero { display: flex; align-items: center; gap: 24px; margin: 24px 0; }
  .score-ring { width: 110px; height: 110px; flex: none; }
  .score-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px; }
  .score-card { background: #fff; border: 1px solid #e2e5ea; border-radius: 8px; padding: 10px 12px; }
  .score-card b { font-size: 20px; }
  .score-card .ev { color: #6b7280; font-size: 12px; margin-top: 4px; }
  .bar { height: 6px; border-radius: 3px; background: #edeff2; margin-top: 6px; overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 3px; }
  .finding { background: #fff; border: 1px solid #e2e5ea; border-left-width: 5px; border-radius: 8px; padding: 12px 16px; margin: 10px 0; }
  .finding.critical { border-left-color: #d92d20; }
  .finding.major { border-left-color: #f79009; }
  .finding.minor { border-left-color: #667085; }
  .finding .cat { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; }
  .finding .rec { background: #f0f9f4; border-radius: 6px; padding: 8px 10px; font-size: 13px; margin-top: 8px; }
  table { border-collapse: collapse; width: 100%; background: #fff; font-size: 13px; }
  th, td { border: 1px solid #e2e5ea; padding: 6px 10px; text-align: left; }
  th { background: #eef0f4; }
  .journal { font-size: 13px; background: #fff; border: 1px solid #e2e5ea; border-radius: 8px; padding: 8px 14px; max-height: 420px; overflow-y: auto; }
  .journal p { margin: 6px 0; }
  .journal .r { color: #6b7280; font-style: italic; }
  svg { background: #fff; border: 1px solid #e2e5ea; border-radius: 8px; display: block; max-width: 100%; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; margin-right: 14px; font-size: 12px; }
  .legend i { width: 14px; height: 3px; display: inline-block; }
  .shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .shots figure { margin: 0; background: #fff; border: 1px solid #e2e5ea; border-radius: 8px; padding: 8px; }
  .shots img { width: 100%; border-radius: 4px; }
  .shots figcaption { font-size: 12px; color: #6b7280; padding-top: 4px; }
  ul.recs li { margin: 6px 0; }
  .heat-wrap { position: relative; display: inline-block; }
  footer { margin-top: 48px; color: #98a2b3; font-size: 12px; text-align: center; }
</style>
</head>
<body>
<main>
  <h1>Experience Report</h1>
  <div class="meta">${escapeHtml(result.startUrl)} · persona <b>${escapeHtml(result.personaName)}</b> · seed ${result.seed} · ${escapeHtml(report.generatedAt)}</div>

  <div class="summary">${escapeHtml(report.executiveSummary)}</div>

  <div class="score-hero">
    ${scoreRing(report.overallScore)}
    <div>
      <div style="font-size:22px;font-weight:700">Overall Experience: ${report.overallScore}/100</div>
      <div style="color:#6b7280">${critical.length} critical · ${major.length} major · ${minor.length} minor findings · ${result.usage.steps} interactions · ${(result.usage.durationMs / 60000).toFixed(1)} simulated minutes</div>
    </div>
  </div>

  <h2>Scores</h2>
  <div class="score-grid">
    ${result.scores
      .filter((s) => s.dimension !== "overall")
      .map(
        (s) =>
          `<div class="score-card"><div>${escapeHtml(labelOf(s.dimension))}</div><b>${s.value}</b><div class="bar"><i style="width:${s.value}%;background:${scoreColor(s.value)}"></i></div><div class="ev">${escapeHtml(s.evidence[0] ?? "")}</div></div>`,
      )
      .join("\n    ")}
  </div>

  ${findingSection("Critical Findings", critical)}
  ${findingSection("Major UX Issues", major)}
  ${findingSection("Minor UX Issues", minor)}

  <h2>Emotional Timeline</h2>
  <div class="legend">
    <span><i style="background:#12b76a"></i>confidence</span>
    <span><i style="background:#d92d20"></i>frustration</span>
    <span><i style="background:#f79009"></i>confusion</span>
    <span><i style="background:#2970ff"></i>trust</span>
    <span><i style="background:#98a2b3"></i>fatigue</span>
  </div>
  ${emotionSvg(result.emotionTimeline)}

  <h2>Workflow Analysis</h2>
  ${
    result.workflows.length === 0
      ? "<p>No recognizable workflows were discovered.</p>"
      : `<table><tr><th>Workflow</th><th>Screens</th><th>Completed</th><th>Errors</th></tr>${result.workflows
          .map(
            (w) =>
              `<tr><td>${escapeHtml(w.kind)}</td><td>${w.screens.length}</td><td>${w.completed ? "✅" : "❌"}</td><td>${w.errorCount}</td></tr>`,
          )
          .join("")}</table>`
  }

  <h2>Interaction Heatmap</h2>
  ${heatmapSvg(report)}

  <h2>Session Journal</h2>
  <div class="journal">
    ${result.iterations
      .map(
        (it) =>
          `<p><b>#${it.step}</b> <code>${escapeHtml(it.actionDescription)}</code><br><span class="r">${escapeHtml(it.rationale)}</span></p>`,
      )
      .join("\n    ")}
  </div>

  ${screenshotsSection(report)}

  <h2>Recommendations</h2>
  <h3>Quick Wins</h3>
  <ul class="recs">${report.quickWins.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>
  <h3>Long-Term Improvements</h3>
  <ul class="recs">${report.longTermImprovements.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>

  <footer>Generated by Experience Validation Engine — AI that experiences software like a human.</footer>
</main>
</body>
</html>`;
}

/* ------------------------------------------------------------------ */

function findingSection(title: string, findings: readonly Finding[]): string {
  return `<h2>${escapeHtml(title)} (${findings.length})</h2>
  ${
    findings.length === 0
      ? "<p><i>None.</i></p>"
      : findings
          .map(
            (f) => `<div class="finding ${f.severity}">
    <div class="cat">${escapeHtml(f.id)} · ${escapeHtml(f.category)} · ${escapeHtml(f.url)}</div>
    <b>${escapeHtml(f.title)}</b>
    <div>${escapeHtml(f.description)}</div>
    ${f.evidence.length ? `<div class="ev" style="font-size:12px;color:#6b7280;margin-top:6px">${f.evidence.map((e) => escapeHtml(e)).join(" · ")}</div>` : ""}
    ${f.recommendation ? `<div class="rec">💡 ${escapeHtml(f.recommendation)}</div>` : ""}
  </div>`,
          )
          .join("\n  ")
  }`;
}

function emotionSvg(timeline: readonly EmotionSample[]): string {
  const width = 940;
  const height = 220;
  const pad = 30;
  if (timeline.length < 2) return "<p><i>Not enough data for a timeline.</i></p>";
  const series: Array<{ key: keyof EmotionSample["values"]; color: string }> = [
    { key: "confidence", color: "#12b76a" },
    { key: "frustration", color: "#d92d20" },
    { key: "confusion", color: "#f79009" },
    { key: "trust", color: "#2970ff" },
    { key: "fatigue", color: "#98a2b3" },
  ];
  const x = (i: number) => pad + (i / (timeline.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - v * (height - pad * 2);
  const polylines = series
    .map(({ key, color }) => {
      const points = timeline
        .map((s, i) => `${x(i).toFixed(1)},${y(s.values[key]).toFixed(1)}`)
        .join(" ");
      return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${points}"/>`;
    })
    .join("\n  ");
  const gridlines = [0, 0.25, 0.5, 0.75, 1]
    .map(
      (v) =>
        `<line x1="${pad}" y1="${y(v)}" x2="${width - pad}" y2="${y(v)}" stroke="#eef0f4"/><text x="4" y="${y(v) + 4}" font-size="10" fill="#98a2b3">${Math.round(v * 100)}</text>`,
    )
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Emotional timeline">
  ${gridlines}
  ${polylines}
  <text x="${pad}" y="${height - 8}" font-size="10" fill="#98a2b3">step 0</text>
  <text x="${width - pad - 50}" y="${height - 8}" font-size="10" fill="#98a2b3">step ${timeline[timeline.length - 1]!.step}</text>
</svg>`;
}

function heatmapSvg(report: ExperienceReport): string {
  const { result } = report;
  const clicks = result.iterations
    .filter((it) => it.clickPoint !== null)
    .map((it) => it.clickPoint!);
  if (clicks.length === 0) return "<p><i>No pointer interactions were recorded.</i></p>";
  const vw = 1280;
  const vh = 800;
  const scale = 940 / vw;
  const circles = clicks
    .map(
      (p, i) =>
        `<circle cx="${(p.x * scale).toFixed(1)}" cy="${(p.y * scale).toFixed(1)}" r="14" fill="#d92d20" opacity="0.22"/><circle cx="${(p.x * scale).toFixed(1)}" cy="${(p.y * scale).toFixed(1)}" r="3" fill="#d92d20" opacity="0.8"><title>click #${i + 1}</title></circle>`,
    )
    .join("");
  const background =
    result.screenshots.length > 0
      ? `<image href="data:image/png;base64,${result.screenshots[0]!.toString("base64")}" x="0" y="0" width="940" height="${(vh * scale).toFixed(0)}" opacity="0.55"/>`
      : `<rect width="940" height="${(vh * scale).toFixed(0)}" fill="#fbfbfc"/>`;
  return `<svg viewBox="0 0 940 ${(vh * scale).toFixed(0)}" role="img" aria-label="Interaction heatmap (viewport-relative click positions)">
  ${background}
  ${circles}
</svg>
<p style="font-size:12px;color:#6b7280">All ${clicks.length} pointer interactions, plotted in viewport coordinates${result.screenshots.length ? " over the first screenshot" : ""}.</p>`;
}

function screenshotsSection(report: ExperienceReport): string {
  const shots = report.result.screenshots;
  if (shots.length === 0) return "";
  const maxShots = 12;
  const figures = shots
    .slice(0, maxShots)
    .map(
      (buffer, i) =>
        `<figure><img src="data:image/png;base64,${buffer.toString("base64")}" alt="Screenshot ${i}" loading="lazy"><figcaption>Screenshot ${i}</figcaption></figure>`,
    )
    .join("\n    ");
  return `<h2>Screenshots</h2>\n  <div class="shots">${figures}</div>${shots.length > maxShots ? `<p style="font-size:12px;color:#6b7280">${shots.length - maxShots} more screenshots omitted for file size.</p>` : ""}`;
}

function scoreRing(score: number): string {
  const r = 46;
  const c = 2 * Math.PI * r;
  const filled = (score / 100) * c;
  return `<svg class="score-ring" viewBox="0 0 110 110" style="border:none;background:none">
    <circle cx="55" cy="55" r="${r}" fill="none" stroke="#e2e5ea" stroke-width="10"/>
    <circle cx="55" cy="55" r="${r}" fill="none" stroke="${scoreColor(score)}" stroke-width="10"
      stroke-dasharray="${filled.toFixed(1)} ${c.toFixed(1)}" stroke-linecap="round" transform="rotate(-90 55 55)"/>
    <text x="55" y="62" text-anchor="middle" font-size="26" font-weight="700" fill="#1e2430">${score}</text>
  </svg>`;
}

function scoreColor(score: number): string {
  return score >= 75 ? "#12b76a" : score >= 55 ? "#f79009" : "#d92d20";
}

function labelOf(dimension: string): string {
  return dimension
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

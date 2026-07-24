/**
 * Rendering for an application map — a Markdown report and a Mermaid diagram
 * of the navigation graph.
 */

import type { ApplicationMap } from "./appmap.js";

function shortName(id: string): string {
  const cleaned = id.replace(/[#?].*$/, "").replace(/\/+$/, "");
  const parts = cleaned.split(/[/:]/).filter(Boolean);
  return parts.at(-1) ?? id;
}

/** Stable, mermaid-safe node id derived from a screen URL. */
function nodeId(id: string, index: number): string {
  const base = shortName(id).replace(/[^a-zA-Z0-9]/g, "_");
  return `${base || "screen"}_${index}`;
}

/** Render the navigation graph as a Mermaid flowchart. */
export function renderApplicationMapMermaid(map: ApplicationMap): string {
  const ids = new Map<string, string>();
  map.screens.forEach((s, i) => ids.set(s.id, nodeId(s.id, i)));

  const lines: string[] = ["flowchart LR"];
  for (const s of map.screens) {
    const label = shortName(s.id).replace(/"/g, "'");
    lines.push(`  ${ids.get(s.id)}["${label}"]`);
  }
  for (const t of map.transitions) {
    const from = ids.get(t.from);
    const to = ids.get(t.to);
    if (!from || !to) continue;
    lines.push(`  ${from} --> ${to}`);
  }
  return lines.join("\n");
}

/** Render the application map as a Markdown report (with a Mermaid diagram). */
export function renderApplicationMapMarkdown(map: ApplicationMap): string {
  const lines: string[] = [
    `# Application map — ${map.url}`,
    "",
    `Discovered by autonomous exploration: **${map.coverage.screens} screens**, ` +
      `**${map.coverage.transitions} transitions**. Generated ${map.generatedAt}.`,
    "",
    "## Navigation graph",
    "",
    "```mermaid",
    renderApplicationMapMermaid(map),
    "```",
    "",
    "## Screens",
  ];
  for (const s of map.screens) {
    lines.push(
      `- **${shortName(s.id)}** — _${s.purpose}_ · ${s.affordances.length} affordances, ` +
        `${s.inDegree} in / ${s.outDegree} out` +
        (map.entryPoints.includes(s.id) ? " · entry point" : "") +
        (map.deadEnds.includes(s.id) ? " · dead-end" : ""),
    );
    if (s.unexercised.length) {
      lines.push(`  - Unexercised affordances (candidate hidden/edge paths): ${s.unexercised.join(", ")}`);
    }
  }

  lines.push("", "## Information architecture (by purpose)");
  const byPurpose = new Map<string, string[]>();
  for (const s of map.screens) {
    const list = byPurpose.get(s.purpose) ?? [];
    list.push(shortName(s.id));
    byPurpose.set(s.purpose, list);
  }
  for (const [purpose, members] of [...byPurpose.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`- **${purpose}:** ${members.join(", ")}`);
  }

  lines.push("", "## Structure");
  lines.push(`- **Entry points:** ${map.entryPoints.map(shortName).join(", ") || "—"}`);
  lines.push(`- **Hubs:** ${map.hubs.map(shortName).join(", ") || "—"}`);
  lines.push(`- **Dead-ends:** ${map.deadEnds.map(shortName).join(", ") || "—"}`);
  lines.push("");
  return lines.join("\n");
}

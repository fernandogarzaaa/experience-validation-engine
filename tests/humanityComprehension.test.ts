import { describe, expect, it } from "vitest";
import {
  analyzeComprehension,
  artifactFromText,
  countSyllables,
  findAcronyms,
  measureReadability,
} from "../src/humanity/index.js";
import { getPersona } from "../src/personas/index.js";

const firstTimer = getPersona("first-time-user");
const powerUser = getPersona("power-user");

function titlesOf(findings: readonly { title: string }[]): string {
  return findings.map((f) => f.title).join(" | ");
}

describe("readability", () => {
  it("scores plain English above professional register", () => {
    const plain = measureReadability("The cat sat on the mat. It was warm. We were glad.");
    const dense = measureReadability(
      "Subsequent instrumentation of the orchestration subsystem demonstrated that the previously identified serialization anomalies were attributable to insufficient provisioning granularity.",
    );
    expect(plain.fleschReadingEase).toBeGreaterThan(dense.fleschReadingEase);
    expect(dense.gradeLevel).toBeGreaterThan(plain.gradeLevel);
  });

  it("counts syllables the way the Flesch heuristic does", () => {
    expect(countSyllables("cat")).toBe(1);
    expect(countSyllables("running")).toBe(2);
    expect(countSyllables("orchestration")).toBeGreaterThanOrEqual(4);
    expect(countSyllables("")).toBe(0);
  });

  it("treats an acronym as introduced only where the text expands it", () => {
    const uses = findAcronyms([
      "Our Service Level Objective (SLO) held all quarter.",
      "The SRE team disagreed.",
    ]);
    const byName = new Map(uses.map((use) => [use.acronym, use]));
    expect(byName.get("SLO")?.introduced).toBe(true);
    expect(byName.get("SRE")?.introduced).toBe(false);
  });

  it("does not flag acronyms every reader already has", () => {
    const uses = findAcronyms(["Fetch the JSON over HTTPS from the API."]);
    expect(uses).toEqual([]);
  });
});

describe("comprehension", () => {
  it("is persona-relative: a specialist keeps more of a dense passage", () => {
    const artifact = artifactFromText(
      "dense.md",
      "The idempotent retry path relies on backpressure from the sharded write layer, so SLO attainment degrades when replication lag exceeds the quorum window.",
    );
    const novice = analyzeComprehension(artifact, firstTimer).comprehensionScore;
    const expert = analyzeComprehension(artifact, powerUser).comprehensionScore;
    expect(expert).toBeGreaterThan(novice);
  });

  it("is deterministic for the same artifact and reader", () => {
    const artifact = artifactFromText("d.md", "# Title\n\nSome prose about the SLO and the SRE.");
    const first = analyzeComprehension(artifact, firstTimer);
    const second = analyzeComprehension(artifact, firstTimer);
    expect(first).toEqual(second);
  });

  it("cites the text behind every finding", () => {
    const artifact = artifactFromText(
      "d.md",
      "The RBAC subsystem now enforces the SLO across every tenant.\n\n![](chart.png)\n",
    );
    const analysis = analyzeComprehension(artifact, firstTimer);
    expect(analysis.findings.length).toBeGreaterThan(0);
    for (const finding of analysis.findings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(finding.category.startsWith("humanity.")).toBe(true);
    }
  });

  it("flags a number with nothing to compare against, in an analytics artifact", () => {
    const artifact = artifactFromText(
      "m.md",
      "Revenue: 1240000\n\nActive accounts: 18400\n\nSupport tickets: 940\n\nChurn: 4\n",
      { genre: "analytics" },
    );
    const analysis = analyzeComprehension(artifact, firstTimer);
    expect(titlesOf(analysis.findings)).toContain("nothing to compare against");
  });

  it("accepts a number that carries its own baseline", () => {
    const artifact = artifactFromText("m.md", "Revenue: 1240000 (up from 1090000 last quarter)\n", {
      genre: "analytics",
    });
    const analysis = analyzeComprehension(artifact, firstTimer);
    expect(titlesOf(analysis.findings)).not.toContain("nothing to compare against");
  });

  it("flags a numeric table column whose header states no unit", () => {
    const artifact = artifactFromText(
      "t.csv",
      "region,revenue,latency_p99\nus,600000,940\neu,410000,1200\n",
    );
    const analysis = analyzeComprehension(artifact, firstTimer);
    expect(titlesOf(analysis.findings)).toContain("carry no unit in the header");
  });

  it("does not flag a column that names its unit", () => {
    const artifact = artifactFromText(
      "t.csv",
      "region,revenue (USD),p99 (ms)\nus,600000,940\neu,410000,1200\n",
    );
    const analysis = analyzeComprehension(artifact, firstTimer);
    expect(titlesOf(analysis.findings)).not.toContain("carry no unit in the header");
  });

  it("holds slides to slide expectations, not document ones", () => {
    const slide = (title: string) =>
      [
        `## ${title}`,
        "",
        ...Array.from(
          { length: 9 },
          (_, i) => `- A supporting point number ${i + 1} that carries several words of detail`,
        ),
      ].join("\n");
    // Three slides: one label title is a choice, three is a pattern, which is
    // the only thing the check is willing to call a finding.
    const busy = [slide("Results"), slide("Roadmap"), slide("Risks")].join("\n\n---\n\n");
    const artifact = artifactFromText("deck.md", busy, { genre: "presentation" });
    const analysis = analyzeComprehension(artifact, firstTimer);
    expect(titlesOf(analysis.findings)).toContain("too dense to read at slide pace");
    expect(titlesOf(analysis.findings)).toContain("name a topic instead of making a point");
  });

  it("flags a transcript error that never says what to do next", () => {
    const artifact = artifactFromText(
      "s.log",
      [
        "$ deploy",
        "Error: connection refused",
        "",
        "$ deploy",
        "Fatal: the token expired",
        "",
        "$ deploy",
        "Failure: unable to reach the registry",
      ].join("\n"),
    );
    const analysis = analyzeComprehension(artifact, firstTimer);
    expect(titlesOf(analysis.findings)).toContain("state what failed but not what to do");
  });

  it("accepts an error that points at a remedy", () => {
    const artifact = artifactFromText(
      "s.log",
      "$ deploy\nError: token expired — run `widget login` and try again\n",
    );
    const analysis = analyzeComprehension(artifact, firstTimer);
    expect(titlesOf(analysis.findings)).not.toContain("state what failed but not what to do");
  });

  it("flags prose with no headings and no way back in", () => {
    const paragraph = "The team continued the work and reported on it. ".repeat(12);
    const artifact = artifactFromText("d.txt", `${paragraph}\n\n`.repeat(5));
    const analysis = analyzeComprehension(artifact, firstTimer);
    expect(titlesOf(analysis.findings)).toContain("no headings at all");
  });

  it("says nothing about a short, clear, well-formed document", () => {
    const artifact = artifactFromText(
      "d.md",
      [
        "# Ship the new signup page",
        "",
        "We recommend shipping on Friday. The page is done and tested.",
        "",
        "## What to do",
        "",
        "- Please review the copy by Thursday",
        "- Then we ship",
      ].join("\n"),
    );
    const analysis = analyzeComprehension(artifact, firstTimer);
    expect(analysis.findings).toEqual([]);
    expect(analysis.comprehensionScore).toBeGreaterThan(90);
  });
});

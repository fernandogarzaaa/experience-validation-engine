import { describe, expect, it } from "vitest";
import {
  artifactFromText,
  parseMetric,
  readArtifactText,
  selectReader,
} from "../src/humanity/index.js";

describe("artifact readers", () => {
  it("reads markdown structure into sections in reading order", () => {
    const artifact = artifactFromText(
      "notes.md",
      [
        "# Release 4.2",
        "",
        "Ships on Friday.",
        "",
        "## Upgrade",
        "",
        "- Run the migration",
        "- Restart workers",
        "",
        "| env | version |",
        "| --- | --- |",
        "| prod | 4.1 |",
      ].join("\n"),
    );

    expect(artifact.format).toBe("markdown");
    expect(artifact.genre).toBe("document");
    expect(artifact.title).toBe("Release 4.2");
    expect(artifact.sections.map((s) => s.title)).toEqual(["Release 4.2", "Upgrade"]);
    expect(artifact.blocks.map((b) => b.kind)).toEqual([
      "title",
      "paragraph",
      "heading",
      "list-item",
      "list-item",
      "table",
    ]);
    const table = artifact.blocks.at(-1)?.table;
    expect(table?.columns).toEqual(["env", "version"]);
    expect(table?.rows).toEqual([["prod", "4.1"]]);
  });

  it("recognizes a markdown deck as a presentation cut by its separators", () => {
    const deck = [
      "# Vision",
      "",
      "Why we exist.",
      "",
      "---",
      "",
      "## Plan",
      "",
      "Ship it.",
      "",
      "---",
      "",
      "## Risks",
      "",
      "It might not work.",
    ].join("\n");
    const artifact = artifactFromText("deck.md", deck);

    expect(artifact.format).toBe("slides");
    expect(artifact.genre).toBe("presentation");
    expect(artifact.sections).toHaveLength(3);
    expect(artifact.sections[0]?.noun).toBe("slide");
  });

  it("does not mistake a setext underline for a slide break", () => {
    const artifact = artifactFromText("doc.md", "Overview\n---\n\nSome prose here.\n");
    expect(artifact.genre).toBe("document");
    expect(artifact.blocks[0]).toMatchObject({ kind: "heading", text: "Overview", depth: 2 });
  });

  it("keeps a figure's missing alt text distinguishable from an empty one", () => {
    const artifact = artifactFromText("a.md", "![](chart.png)\n\n![Signups fell](trend.png)\n");
    expect(artifact.blocks[0]?.figure).toEqual({
      alt: null,
      caption: null,
      source: "chart.png",
    });
    expect(artifact.blocks[1]?.figure?.alt).toBe("Signups fell");
  });

  it("reads visible HTML text and never script or style content", () => {
    const artifact = artifactFromText(
      "page.html",
      `<!doctype html><html><head><title>Docs</title><style>.a{color:red}</style></head>
       <body><h1>Docs</h1><script>var secret = "do not read me";</script>
       <p>Install it with npm.</p><img src="d.png" alt="diagram"></body></html>`,
    );

    const text = artifact.blocks.map((b) => b.text).join(" ");
    expect(artifact.title).toBe("Docs");
    expect(text).toContain("Install it with npm.");
    expect(text).not.toContain("do not read me");
    expect(text).not.toContain("color:red");
    expect(artifact.blocks.find((b) => b.figure)?.figure?.alt).toBe("diagram");
  });

  it("reads a uniform JSON array as a table rather than a field list", () => {
    const artifact = artifactFromText(
      "rows.json",
      JSON.stringify([
        { region: "us", accounts: 4 },
        { region: "eu", accounts: 7 },
      ]),
    );
    expect(artifact.format).toBe("json");
    expect(artifact.blocks[0]?.table?.columns).toEqual(["region", "accounts"]);
  });

  it("reports an unparseable payload as content, not as a thrown error", () => {
    const artifact = readArtifactText({
      address: "broken.json",
      text: "{ not json at all",
      extension: ".json",
    });
    expect(artifact.blocks[0]?.kind).toBe("error");
    expect(artifact.blocks[0]?.text).toContain("could not be parsed");
  });

  it("splits a CSV on quoted delimiters", () => {
    const artifact = artifactFromText("t.csv", 'name,note\n"Smith, Jo","said ""hi"""\n');
    expect(artifact.genre).toBe("analytics");
    expect(artifact.blocks[0]?.table?.rows[0]).toEqual(["Smith, Jo", 'said "hi"']);
  });

  it("recovers commands, output and errors from a terminal transcript", () => {
    const artifact = artifactFromText(
      "session.log",
      ["$ npm test", "42 passed", "", "$ npm run deploy", "Error: connection refused"].join("\n"),
    );

    expect(artifact.genre).toBe("transcript");
    expect(artifact.blocks.filter((b) => b.kind === "command").map((b) => b.text)).toEqual([
      "npm test",
      "npm run deploy",
    ]);
    expect(artifact.blocks.find((b) => b.kind === "error")?.text).toContain("connection refused");
  });

  it("reads CLI help output as an interface listing", () => {
    const artifact = artifactFromText(
      "help.txt",
      [
        "Usage: widget <command>",
        "",
        "Commands:",
        "  build          Compile the project",
        "  serve",
        "  clean",
      ].join("\n"),
    );

    expect(artifact.genre).toBe("interface");
    const fields = artifact.blocks.filter((b) => b.kind === "field").map((b) => b.text);
    expect(fields).toContain("build — Compile the project");
    expect(fields).toContain("serve");
  });

  it("falls back to the plain-text reader for input nothing else claims", () => {
    const reader = selectReader({ address: "x", text: "just a sentence.", extension: null });
    expect(reader.format).toBe("text");
  });
});

describe("metric recognition", () => {
  it("pulls value, unit and baseline out of a reported number", () => {
    expect(parseMetric("Revenue: $1.24M (up from $1.09M last quarter)")).toMatchObject({
      label: "Revenue",
      // The magnitude suffix is split off as the unit, so "1.24" is never
      // compared against "1.09" as if they were the same scale.
      value: "$1.24",
      unit: "M",
      baseline: "up from $1.09M last quarter",
    });
    expect(parseMetric("p99 latency: 940ms")).toMatchObject({
      value: "940",
      unit: "ms",
      baseline: null,
    });
  });

  it("does not treat prose about a number as a reported metric", () => {
    expect(parseMetric("We grew 14% last year and it was hard work")).toBeNull();
    expect(parseMetric("2024: strong")).toBeNull();
    expect(parseMetric("The team shipped it")).toBeNull();
  });
});

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

  it("parses a forced slides format as markdown, not as plain text", () => {
    // No reader advertises "slides" — it is a markdown shape. Forcing it has
    // to route to the markdown reader, or a deck piped in with no extension
    // gets read as prose and relabelled, losing its `---` breaks entirely.
    const deck = "# One\n\nFirst.\n\n---\n\n# Two\n\nSecond.";
    const artifact = readArtifactText({
      address: "-",
      text: deck,
      extension: null,
      format: "slides",
    });

    expect(artifact.format).toBe("slides");
    expect(artifact.genre).toBe("presentation");
    expect(artifact.sections).toHaveLength(2);
    expect(artifact.sections[0]?.noun).toBe("slide");
  });

  it("falls back to the plain-text reader for input nothing else claims", () => {
    const reader = selectReader({ address: "x", text: "just a sentence.", extension: null });
    expect(reader.format).toBe("text");
  });
});

describe("markup never survives into perceived text", () => {
  /**
   * `stripInline` is not a sanitizer and must not be used as one — EVE's HTML
   * reporting escapes independently. But it is what decides *what a reader
   * saw*, and a reader does not see markup, so no tag may survive it. A
   * single global replace is not enough: it never revisits ground it has
   * covered, so removing the inner tag of `<<a>script>` splices the halves
   * back into `<script>`, and an unterminated `<script` never matches at all.
   */
  const markupSurvives = (text: string): boolean =>
    artifactFromText("t.md", text)
      .blocks.map((block) => block.text)
      .join(" ")
      .includes("<");

  it("removes a tag spliced together by removing an inner one", () => {
    expect(markupSurvives("<<a>script>alert(1)<</b>/script>")).toBe(false);
  });

  it("removes an unterminated tag, which no closing bracket ever matches", () => {
    expect(markupSurvives("Read this <script")).toBe(false);
    expect(markupSurvives("<img src=x onerror=alert(1)")).toBe(false);
  });

  it("removes deeply nested brackets without leaving a tag behind", () => {
    const nested = `${"<".repeat(60)}script${">".repeat(60)}`;
    const text = artifactFromText("t.md", nested)
      .blocks.map((block) => block.text)
      .join(" ");
    expect(text).not.toContain("<script");
  });

  it("leaves a lone angle bracket in prose alone — a reader sees it", () => {
    const artifact = artifactFromText("t.md", "Fails when x < y and y > z.");
    expect(artifact.blocks[0]?.text).toBe("Fails when x < y and y > z.");
  });

  it("still strips ordinary inline HTML down to its text", () => {
    const artifact = artifactFromText("t.md", "plain <b>bold</b> and <em>italic</em> text");
    expect(artifact.blocks[0]?.text).toBe("plain bold and italic text");
  });

  it("removes an unterminated tag the HTML tokenizer cannot see either", () => {
    const artifact = artifactFromText("p.html", "<p>Install it. <script</p>");
    const text = artifact.blocks.map((block) => block.text).join(" ");
    expect(text).toContain("Install it.");
    expect(text).not.toContain("<script");
  });
});

describe("readers on pathological input", () => {
  /**
   * A reader is pointed at whatever a caller hands it — a log from CI, a file
   * from an issue, a URL. A line that happens to be a long run of the
   * characters a pattern cares about is ordinary input, so parsing it has to
   * stay linear. Both inputs below took seconds against the earlier phrasings
   * of the table-divider and shell-prompt patterns, which let whitespace and
   * pipes belong to two parts of the same match.
   */
  const BUDGET_MS = 1000;

  function timed(fn: () => void): number {
    const start = performance.now();
    fn();
    return performance.now() - start;
  }

  it("parses a long pipe-and-dash line without backtracking", () => {
    const line = `|${"-|".repeat(32_000)}x`;
    const elapsed = timed(() => artifactFromText("t.md", `| a | b |\n${line}\n`));
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("parses a long prompt-shaped line without backtracking", () => {
    const line = `a@b${" ".repeat(32_000)}x`;
    const elapsed = timed(() => artifactFromText("t.log", `$ run\n${line}\n`));
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it("stays linear across every format, not just the two that regressed", () => {
    const n = 40_000;
    const cases: [string, string][] = [
      ["t.md", `a${" ".repeat(n)}b\n`],
      ["t.md", "word ".repeat(n)],
      ["t.html", `<div ${"a=1 ".repeat(n / 4)}>hi</div>`],
      ["t.csv", `a,b\n"${"x".repeat(n)}",1\n`],
      ["t.txt", `Usage: x\n\nOptions:\n  --flag${" ".repeat(n)}desc\n`],
      ["t.log", `Error: it failed\n${"x".repeat(n)}\n`],
    ];
    for (const [address, text] of cases) {
      const elapsed = timed(() => artifactFromText(address, text));
      expect(elapsed, `${address} took ${elapsed.toFixed(0)}ms`).toBeLessThan(BUDGET_MS);
    }
  });

  it("still recognizes every shell prompt shape it is meant to", () => {
    const artifact = artifactFromText(
      "s.log",
      [
        "$ npm test",
        "> npm run deploy",
        "user@host:~/dir$ ls -la",
        "PS C:\\Users\\jo> Get-Item",
        "~/src ❯ git status",
        "➜  cd repo",
      ].join("\n"),
    );
    expect(artifact.blocks.filter((b) => b.kind === "command").map((b) => b.text)).toEqual([
      "npm test",
      "npm run deploy",
      "ls -la",
      "Get-Item",
      "git status",
      "cd repo",
    ]);
  });

  it("does not mistake output for a prompt", () => {
    const artifact = artifactFromText(
      "s.log",
      ["$ npm test", "42 passed", "Tests: 1 failed", "  at Foo.bar (x.js:1)"].join("\n"),
    );
    expect(artifact.blocks.filter((b) => b.kind === "command")).toHaveLength(1);
  });

  it("requires a dash in a table divider, as markdown does", () => {
    const notATable = artifactFromText("t.md", "| a | b |\n|   |   |\n| 1 | 2 |\n");
    expect(notATable.blocks.some((b) => b.table)).toBe(false);

    for (const divider of ["| --- | --- |", "|---|:---:|", "| :-- | --: |"]) {
      const artifact = artifactFromText("t.md", `| a | b |\n${divider}\n| 1 | 2 |\n`);
      expect(artifact.blocks.find((b) => b.table)?.table?.rows).toEqual([["1", "2"]]);
    }
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

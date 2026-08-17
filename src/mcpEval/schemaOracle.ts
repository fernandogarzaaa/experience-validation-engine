/**
 * Schema oracle — deterministic checks over the tools a server advertises.
 *
 * Pure function, no I/O: given the `tools/list` payload, find schema defects
 * a client would trip over. Checks cover three families:
 *
 * 1. **JSON Schema correctness** — the input schema must be an object schema
 *    whose `required` entries exist in `properties`, and each property must
 *    be a describable schema.
 * 2. **Description quality** — a tool with no description (or one that just
 *    restates its name) is un-navigable for agents and humans alike; the
 *    MCP spec itself pushes descriptive metadata as the discovery channel.
 * 3. **Annotation honesty** — name/annotation mismatches (`delete_*` with
 *    `destructiveHint: false`, `get_*` with `readOnlyHint: false`) mislead
 *    clients that gate calls on annotations.
 *
 * The tool shape is the advertised-wire shape, not the SDK's validated
 * `Tool` type: a *broken* server can advertise malformed schemas, and
 * catching exactly that is this oracle's job.
 */

import type { McpFinding } from "./types.js";

/** A tool as advertised on the wire (possibly malformed — that's the point). */
export interface AdvertisedTool {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly inputSchema?: unknown;
  readonly annotations?: unknown;
}

interface AnnotationHints {
  readonly readOnlyHint?: boolean;
  readonly destructiveHint?: boolean;
}

const DESTRUCTIVE_NAME = /^(delete|remove|destroy|drop|purge|erase|reset|clear|kill|terminate)/i;
const READONLY_NAME = /^(get|list|read|fetch|search|query|describe|show|view|find)/i;
const MIN_DESCRIPTION_CHARS = 20;

let nextId = 0;
/** Reset the finding-id counter (tests; ids are per-run otherwise). */
export function resetFindingIds(): void {
  nextId = 0;
}

export function makeFinding(finding: Omit<McpFinding, "id">): McpFinding {
  return { id: `mcp-f-${++nextId}`, ...finding };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A property schema is describable if it pins *some* constraint. */
function propertyIsDescribable(prop: unknown): boolean {
  if (!isRecord(prop)) return false;
  return (
    typeof prop.type === "string" ||
    Array.isArray(prop.enum) ||
    prop.const !== undefined ||
    prop.$ref !== undefined ||
    prop.anyOf !== undefined ||
    prop.oneOf !== undefined ||
    prop.allOf !== undefined
  );
}

function annotationsOf(tool: AdvertisedTool): AnnotationHints | null {
  if (!isRecord(tool.annotations)) return null;
  const hints: { readOnlyHint?: boolean; destructiveHint?: boolean } = {};
  if (typeof tool.annotations.readOnlyHint === "boolean") {
    hints.readOnlyHint = tool.annotations.readOnlyHint;
  }
  if (typeof tool.annotations.destructiveHint === "boolean") {
    hints.destructiveHint = tool.annotations.destructiveHint;
  }
  return hints;
}

/** Check every advertised tool; return evidence-backed findings. */
export function checkToolSchemas(tools: readonly AdvertisedTool[]): McpFinding[] {
  const findings: McpFinding[] = [];
  const seenNames = new Set<string>();

  for (const tool of tools) {
    const name = typeof tool.name === "string" ? tool.name : "(unnamed tool)";

    if (typeof tool.name !== "string" || tool.name.length === 0) {
      findings.push(
        makeFinding({
          severity: "major",
          category: "mcp.schema-quality",
          title: "Tool advertised without a valid name",
          description: "Every tool must advertise a non-empty string name.",
          evidence: [`advertised tool entry: ${JSON.stringify(tool).slice(0, 120)}`],
        }),
      );
      continue;
    }

    if (seenNames.has(name)) {
      findings.push(
        makeFinding({
          severity: "major",
          category: "mcp.schema-quality",
          title: `Duplicate tool name "${name}"`,
          description: "Two tools share a name; clients cannot address either unambiguously.",
          evidence: [`"${name}" appeared twice in tools/list`],
          tool: name,
        }),
      );
    }
    seenNames.add(name);

    /* ---- JSON Schema correctness ---- */
    const schema = tool.inputSchema;
    if (!isRecord(schema)) {
      findings.push(
        makeFinding({
          severity: "major",
          category: "mcp.schema-quality",
          title: `"${name}" has no input schema object`,
          description:
            "MCP tools must advertise an inputSchema; without one clients cannot build valid calls.",
          evidence: [`inputSchema was ${schema === undefined ? "absent" : JSON.stringify(schema)}`],
          tool: name,
        }),
      );
    } else {
      if (schema.type !== "object") {
        findings.push(
          makeFinding({
            severity: "major",
            category: "mcp.schema-quality",
            title: `"${name}" input schema is not an object schema`,
            description:
              'The MCP specification requires every tool inputSchema to have "type": "object".',
            evidence: [`inputSchema.type = ${JSON.stringify(schema.type)}`],
            tool: name,
          }),
        );
      }
      const properties = isRecord(schema.properties) ? schema.properties : {};
      const required = schema.required;
      if (required !== undefined) {
        if (!Array.isArray(required) || required.some((r) => typeof r !== "string")) {
          findings.push(
            makeFinding({
              severity: "major",
              category: "mcp.schema-quality",
              title: `"${name}" has a malformed "required" list`,
              description: '"required" must be an array of property names.',
              evidence: [`required = ${JSON.stringify(required)}`],
              tool: name,
            }),
          );
        } else {
          const dangling = required.filter((r) => !(r in properties));
          if (dangling.length > 0) {
            findings.push(
              makeFinding({
                severity: "major",
                category: "mcp.schema-quality",
                title: `"${name}" requires fields it does not declare`,
                description:
                  "Every required entry must name a declared property; dangling entries make the schema unsatisfiable by construction.",
                evidence: dangling.map((d) => `required "${d}" is absent from properties`),
                tool: name,
              }),
            );
          }
        }
      }
      const undescribable = Object.entries(properties).filter(
        ([, prop]) => !propertyIsDescribable(prop),
      );
      if (undescribable.length > 0) {
        findings.push(
          makeFinding({
            severity: "minor",
            category: "mcp.schema-quality",
            title: `"${name}" has unconstrained properties`,
            description:
              "Properties with no type/enum/$ref/combinator accept anything; clients cannot render or validate them.",
            evidence: undescribable.map(([p]) => `property "${p}" has no type or constraint`),
            tool: name,
          }),
        );
      }
      const undocumentedProps = Object.entries(properties).filter(
        ([, prop]) => !isRecord(prop) || typeof prop.description !== "string",
      );
      if (undocumentedProps.length > 0) {
        findings.push(
          makeFinding({
            severity: "info",
            category: "mcp.schema-quality",
            title: `"${name}" has undocumented properties`,
            description:
              "Property descriptions are how operators (human or agent) learn what an argument means.",
            evidence: undocumentedProps.map(([p]) => `property "${p}" has no description`),
            tool: name,
          }),
        );
      }
    }

    /* ---- Description quality ---- */
    const description = typeof tool.description === "string" ? tool.description.trim() : "";
    if (description.length === 0) {
      findings.push(
        makeFinding({
          severity: "major",
          category: "mcp.schema-quality",
          title: `"${name}" has no description`,
          description:
            "The description is the only discovery channel a client has for what a tool does and when to use it.",
          evidence: [`tools/list entry for "${name}" carries no description`],
          tool: name,
          recommendation: "Write a sentence: what it does, what it returns, when to call it.",
        }),
      );
    } else {
      const restatedName = name.replace(/[_-]+/g, " ").toLowerCase();
      if (description.toLowerCase() === restatedName) {
        findings.push(
          makeFinding({
            severity: "info",
            category: "mcp.schema-quality",
            title: `"${name}" description just restates its name`,
            description: "A description must add information the name does not carry.",
            evidence: [`description = "${description}"`],
            tool: name,
          }),
        );
      } else if (description.length < MIN_DESCRIPTION_CHARS) {
        findings.push(
          makeFinding({
            severity: "minor",
            category: "mcp.schema-quality",
            title: `"${name}" description is too thin to act on`,
            description: `Under ${MIN_DESCRIPTION_CHARS} characters, a description rarely tells a caller what the tool does or returns.`,
            evidence: [`description (${description.length} chars) = "${description}"`],
            tool: name,
          }),
        );
      }
    }

    /* ---- Annotation honesty ---- */
    const hints = annotationsOf(tool);
    if (hints === null) {
      findings.push(
        makeFinding({
          severity: "info",
          category: "mcp.schema-quality",
          title: `"${name}" declares no behavioral annotations`,
          description:
            "readOnlyHint/destructiveHint/idempotentHint/openWorldHint let clients gate calls safely; their absence forces callers to assume the worst.",
          evidence: [`tools/list entry for "${name}" has no annotations object`],
          tool: name,
        }),
      );
    } else {
      if (DESTRUCTIVE_NAME.test(name)) {
        if (hints.destructiveHint === false) {
          findings.push(
            makeFinding({
              severity: "minor",
              category: "mcp.schema-quality",
              title: `"${name}" sounds destructive but says it is not`,
              description:
                "The tool name suggests irreversible change while destructiveHint is false; one of them is lying to the client.",
              evidence: [`name matches ${DESTRUCTIVE_NAME}`, "destructiveHint = false"],
              tool: name,
            }),
          );
        } else if (hints.destructiveHint === undefined) {
          findings.push(
            makeFinding({
              severity: "info",
              category: "mcp.schema-quality",
              title: `"${name}" sounds destructive but declares no destructiveHint`,
              description:
                "Clients that gate destructive calls on hints cannot protect the user here.",
              evidence: [`name matches ${DESTRUCTIVE_NAME}`, "destructiveHint absent"],
              tool: name,
            }),
          );
        }
      }
      if (READONLY_NAME.test(name)) {
        if (hints.readOnlyHint === false) {
          findings.push(
            makeFinding({
              severity: "minor",
              category: "mcp.schema-quality",
              title: `"${name}" sounds read-only but says it is not`,
              description:
                "The tool name suggests a pure read while readOnlyHint is false; one of them misleads the client.",
              evidence: [`name matches ${READONLY_NAME}`, "readOnlyHint = false"],
              tool: name,
            }),
          );
        } else if (hints.readOnlyHint === undefined) {
          findings.push(
            makeFinding({
              severity: "info",
              category: "mcp.schema-quality",
              title: `"${name}" sounds read-only but declares no readOnlyHint`,
              description: "Read-only tools are safe to call speculatively — say so.",
              evidence: [`name matches ${READONLY_NAME}`, "readOnlyHint absent"],
              tool: name,
            }),
          );
        }
      }
    }
  }

  return findings;
}

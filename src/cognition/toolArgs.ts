/**
 * Typed argument synthesis for tool surfaces (Phase 2).
 *
 * Phase 1 funneled JSON Schema types through a single text channel: the
 * persona typed characters and the adapter re-parsed them, so "the operator
 * typed badly" and "the operator probed an edge case" were indistinguishable
 * (projection debt ledger item 4). On the kernel, argument intent is a
 * cognition-side decision: given the schema the surface itself advertises
 * (perceived metadata on an `mcp.tool` affordance), produce plausible,
 * correctly-typed arguments a human operator would try.
 *
 * Everything here is derived from the advertised schema and field naming —
 * the same cues `plausibleInput` uses for web forms — never from server
 * internals.
 */

import type { Rng } from "../core/random.js";

type JsonSchema = Readonly<Record<string, unknown>>;

/**
 * Synthesize arguments for a tool call. Required properties are always
 * filled; optional ones are filled with a coin flip (a human fills what a
 * form seems to ask for, and sometimes more).
 */
export function synthesizeArguments(
  schema: JsonSchema | undefined,
  personaName: string,
  rng: Rng,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const properties = schema?.properties;
  if (typeof properties !== "object" || properties === null) return args;
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  for (const [name, rawProp] of Object.entries(properties as Record<string, unknown>)) {
    const prop = (typeof rawProp === "object" && rawProp !== null ? rawProp : {}) as JsonSchema;
    if (!required.has(name) && !rng.chance(0.5)) continue;
    args[name] = valueForSchema(prop, name, personaName, rng);
  }
  return args;
}

/** A plausible, correctly-typed value for one schema property. */
function valueForSchema(schema: JsonSchema, name: string, personaName: string, rng: Rng): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    // An operator picks one of the offered choices; which one is arbitrary.
    return schema.enum[Math.floor(rng.next() * schema.enum.length)];
  }
  switch (schema.type) {
    case "number":
    case "integer":
      return plausibleNumber(name, schema);
    case "boolean":
      return true;
    case "array": {
      const item =
        typeof schema.items === "object" && schema.items !== null
          ? (schema.items as JsonSchema)
          : {};
      return [valueForSchema(item, name, personaName, rng)];
    }
    case "object":
      return synthesizeArguments(schema, personaName, rng);
    case "string":
      return plausibleString(name, schema, personaName);
    default:
      // Union/unspecified: default to the string channel, the most common.
      return plausibleString(name, schema, personaName);
  }
}

function plausibleNumber(name: string, schema: JsonSchema): number {
  const minimum = typeof schema.minimum === "number" ? schema.minimum : undefined;
  const maximum = typeof schema.maximum === "number" ? schema.maximum : undefined;
  let value = 3;
  if (/count|qty|quantity|amount|size|length|limit|num/i.test(name)) value = 3;
  if (/year|age/i.test(name)) value = 42;
  if (/percent|ratio|rate/i.test(name)) value = 50;
  if (minimum !== undefined && value < minimum) value = minimum;
  if (maximum !== undefined && value > maximum) value = maximum;
  return schema.type === "integer" ? Math.round(value) : value;
}

/**
 * String values keyed off the field's name and description — the operator
 * reads the same cues a web form's label gives. Mirrors the spirit of
 * `plausibleInput` in `heuristicCognition.ts`, but returns strings only
 * (numbers and booleans are typed natively above, never coerced).
 */
function plausibleString(name: string, schema: JsonSchema, personaName: string): string {
  const label = `${name} ${typeof schema.description === "string" ? schema.description : ""}`
    .toLowerCase()
    .replace(/[_-]+/g, " ");
  if (/e-?mail/.test(label)) return `${personaName.replace(/[^a-z0-9]/g, ".")}@example.com`;
  if (/password/.test(label)) return "CorrectHorse!42";
  if (/phone|tel/.test(label)) return "555-0142";
  if (/search|find|query|\bq\b/.test(label)) return "settings";
  if (/first\s*name/.test(label)) return "Alex";
  if (/last\s*name|surname/.test(label)) return "Rivera";
  if (/\bname\b|user/.test(label)) return "Alex Rivera";
  if (/city/.test(label)) return "Springfield";
  if (/zip|postal/.test(label)) return "62704";
  if (/address/.test(label)) return "742 Evergreen Terrace";
  if (/date|dob|birth/.test(label)) return "1990-04-12";
  if (/url|website|link|uri/.test(label)) return "https://example.com";
  if (/title|subject/.test(label)) return "A quick test";
  if (/path|file|dir/.test(label)) return "/tmp/example.txt";
  if (/comment|message|description|note|text|body|content/.test(label)) {
    return "Just trying this out to see how it works.";
  }
  if (/amount|price|number|quantity|qty|count/.test(label)) return "3";
  return "test input";
}

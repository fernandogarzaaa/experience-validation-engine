/**
 * `readArtifact` — the one call that reads a digital output like a human.
 *
 * It wires the pieces the same way `eve run` wires a browser session: a
 * humanity adapter over the artifact, the session loop for the moment-to-
 * moment experience, and the comprehension plugin for the judgment the
 * reader forms about the artifact as a whole. What comes back is an ordinary
 * `SessionResult` — scored, evidence-backed, renderable by every existing
 * report — plus the comprehension analysis alongside it.
 *
 * Finishing is modeled as success, not as running out of budget: the reader
 * perceives the end of the artifact, and that visible line is the session's
 * goal success signal. A document EVE read to the end ends `goal-achieved`;
 * one it put down halfway ends `abandoned`, which is exactly the distinction
 * that makes a reading score mean anything.
 */

import { EveSession, type SessionOptions, type SessionResult } from "../engine/session.js";
import { getPersona } from "../personas/library.js";
import type { Persona } from "../personas/persona.js";
import type { EvePlugin } from "../plugins/plugin.js";
import { HumanityAdapter } from "./adapter.js";
import type { ComprehensionAnalysis } from "./comprehension.js";
import { ComprehensionPlugin } from "./plugin.js";
import { artifactFromText, loadArtifact } from "./source.js";
import type { Artifact, ArtifactFormat, ArtifactGenre } from "./types.js";
import { registerHumanityVocabulary } from "./vocabulary.js";

export interface ReadOptions
  extends Omit<Partial<SessionOptions>, "adapter" | "startUrl" | "persona"> {
  readonly persona?: Persona | string;
  /** Force a reader instead of letting detection choose. */
  readonly format?: ArtifactFormat;
  /** Force the genre instead of inferring it from content. */
  readonly genre?: ArtifactGenre;
  /** Extra plugins, alongside the comprehension plugin. */
  readonly plugins?: readonly EvePlugin[];
}

export interface ReadingResult extends SessionResult {
  /** The artifact as the reader perceived it. */
  readonly artifact: Artifact;
  /** What this reader understood, and what got in the way. */
  readonly comprehension: ComprehensionAnalysis;
}

/** Read an artifact from a path, an http(s) URL, or `-` for standard input. */
export async function readArtifact(
  target: string,
  options: ReadOptions = {},
): Promise<ReadingResult> {
  const artifact = await loadArtifact(target, {
    ...(options.format ? { format: options.format } : {}),
    ...(options.genre ? { genre: options.genre } : {}),
  });
  return readLoadedArtifact(artifact, options);
}

/** Read an artifact already in memory — no filesystem, no network. */
export async function readText(
  address: string,
  text: string,
  options: ReadOptions = {},
): Promise<ReadingResult> {
  return readLoadedArtifact(
    artifactFromText(address, text, {
      ...(options.format ? { format: options.format } : {}),
      ...(options.genre ? { genre: options.genre } : {}),
    }),
    options,
  );
}

/** Run a reading session over an artifact that has already been parsed. */
export async function readLoadedArtifact(
  artifact: Artifact,
  options: ReadOptions = {},
): Promise<ReadingResult> {
  registerHumanityVocabulary();

  const persona: Persona =
    typeof options.persona === "string"
      ? getPersona(options.persona)
      : (options.persona ?? getPersona("first-time-user"));

  const adapter = new HumanityAdapter({ artifact, persona });
  const comprehension = new ComprehensionPlugin(adapter);

  // A reader turns one section per step and may re-read; the default budget
  // is generous enough to finish an artifact of any realistic length rather
  // than reporting "ran out of steps" for a deck that was simply long.
  const maxSteps = options.maxSteps ?? Math.max(40, artifact.sections.length * 4);

  const { format: _format, genre: _genre, plugins, ...sessionOptions } = options;
  const session = new EveSession({
    ...sessionOptions,
    adapter,
    startUrl: artifact.address,
    persona,
    plugins: [comprehension, ...(plugins ?? [])],
    maxSteps,
    goal: options.goal ?? `read and understand "${artifact.title}"`,
    goalSuccessSignals: options.goalSuccessSignals ?? [adapter.endMarker()],
    screenshots: false,
    // Reading has no real latency to wait on: the simulated human clock is
    // the only clock that means anything here, so runs are replayable.
    deterministic: options.deterministic ?? true,
  });

  const result = await session.run();
  const analysis =
    comprehension.result() ??
    // The plugin skips non-document surfaces; a directly-constructed reading
    // session is always one, so this is belt and braces rather than a path.
    (await import("./comprehension.js")).analyzeComprehension(artifact, persona);

  return { ...result, artifact, comprehension: analysis };
}

/**
 * Minting CP/1 documents from EVE's internals.
 *
 * EVE authors three canonical types, and this module is the only place they are
 * created. Centralizing it keeps two invariants that would otherwise be
 * scattered: every document is sealed before it leaves, and every document
 * declares `authored_by: "eve"` — the field ADAM checks to confirm a
 * `FitnessResult` came from something with no stake in the outcome.
 *
 * The mapping from EVE's rich internal state to the canonical types is lossy on
 * purpose. A `Percept` carries screenshots, layout geometry and per-element
 * colors; an `Observation` carries what the operator could report having seen.
 * The protocol's job is to convey evidence across a boundary, not to replicate
 * one component's state inside another.
 */

import { randomUUID } from "node:crypto";
import type { LoopIteration, Percept } from "../core/types.js";
import { seal, timestamp, toBasisPoints } from "./canonical.js";
import type {
  Component,
  CpEvent,
  EventKind,
  Experience,
  ExperienceAction,
  ExperienceOutcome,
  Observation,
  PayloadValue,
  Provenance,
  SubjectType,
  Surface,
} from "./types.js";
import { EVENT_EMITTER } from "./types.js";

/** Build a provenance record stamped with the current instant. */
export function provenance(options: {
  authoredBy?: Component;
  origin: string;
  evidence?: readonly string[];
  derivedFrom?: readonly string[];
  producedAt?: string;
}): Provenance {
  return {
    authored_by: options.authoredBy ?? "eve",
    produced_at: options.producedAt ?? timestamp(),
    origin: options.origin,
    evidence: options.evidence ?? [],
    derived_from: options.derivedFrom ?? [],
    // Overwritten by `seal` once the rest of the document exists.
    content_hash: "",
  };
}

/**
 * Project a {@link Percept} onto a CP/1 {@link Observation}.
 *
 * Signals are the visible text an operator would be able to recount: headings,
 * body text and dialog copy, in the order they were perceived. Affordances are
 * the controls they could see and tell you about. Everything else in the
 * percept — geometry, colors, screenshot buffers, scroll offsets — stays inside
 * EVE, because none of it is a fact another component can act on.
 */
export function observationFrom(options: {
  percept: Percept;
  environmentId: string;
  surface: Surface;
  latencyMs: number;
  errorPerceived: boolean;
  /** Cap on how many signals to carry; the rest are noise across a boundary. */
  maxSignals?: number;
}): Observation {
  const { percept, maxSignals = 24 } = options;

  const signals = [
    ...percept.elements
      .filter((element) => element.text.trim() !== "")
      .map((element) => element.text.trim().replace(/\s+/g, " ")),
    ...percept.dialogs.map((dialog) => dialog.text.trim().replace(/\s+/g, " ")),
  ]
    .filter((text) => text !== "")
    .slice(0, maxSignals);

  // Bounded like `signals`: a dense page would otherwise produce an unbounded
  // array inside a document that crosses the boundary and gets hashed.
  const affordances = percept.elements
    .filter((element) => element.interactive)
    .map((element) => ({
      label: element.text.trim().replace(/\s+/g, " ") || `${element.role}`,
      role: element.role,
      enabled: !element.disabled,
    }))
    .slice(0, maxSignals);

  const document: Observation = {
    cp: "cp1",
    type: "Observation",
    id: randomUUID(),
    environment_id: options.environmentId,
    surface: options.surface,
    at: timestamp(),
    ...(percept.url === "" ? {} : { locator: percept.url }),
    ...(percept.title === "" ? {} : { title: percept.title }),
    signals,
    affordances,
    latency_ms: Math.max(0, Math.round(options.latencyMs)),
    error_perceived: options.errorPerceived,
    provenance: provenance({ origin: options.environmentId }),
  };
  return seal(document as unknown as Record<string, unknown>) as unknown as Observation;
}

/** EVE actions that have no CP/1 counterpart collapse onto the nearest one. */
const ACTION_MAP: Readonly<Record<string, ExperienceAction>> = {
  click: "click",
  // A double click is a click an operator would describe as a click; the
  // distinction matters to the actuator, not to the experience.
  doubleClick: "click",
  // Hovering is how an operator reads a tooltip — an act of reading.
  hover: "read",
  type: "type",
  press: "press",
  scroll: "scroll",
  navigate: "navigate",
  back: "back",
  read: "read",
  wait: "wait",
  abandon: "abandon",
};

/**
 * Project a {@link LoopIteration} onto a CP/1 {@link Experience}.
 *
 * The outcome is derived from the prediction comparison rather than reported
 * separately, so it can never disagree with the surprise value beside it.
 */
export function experienceFrom(options: {
  iteration: LoopIteration;
  observationId: string;
  sessionOrigin: string;
}): Experience {
  const { iteration } = options;
  const outcome = outcomeOf(iteration);

  const document: Experience = {
    cp: "cp1",
    type: "Experience",
    id: randomUUID(),
    observation_id: options.observationId,
    step: iteration.step,
    goal: iteration.goal,
    action: ACTION_MAP[iteration.action.kind] ?? "read",
    action_description: iteration.actionDescription,
    prediction: {
      description: iteration.prediction.description,
      confidence_bp: toBasisPoints(iteration.prediction.confidence),
      expects_change: iteration.prediction.expectsChange,
    },
    outcome,
    surprise_bp: toBasisPoints(iteration.outcome?.surprise ?? 0),
    affect: {
      frustration_bp: toBasisPoints(iteration.emotion.frustration ?? 0),
      trust_bp: toBasisPoints(iteration.emotion.trust ?? 0),
      confidence_bp: toBasisPoints(iteration.emotion.confidence ?? 0),
    },
    provenance: provenance({
      origin: `${options.sessionOrigin}#${iteration.step}`,
      derivedFrom: [options.observationId],
    }),
  };
  return seal(document as unknown as Record<string, unknown>) as unknown as Experience;
}

function outcomeOf(iteration: LoopIteration): ExperienceOutcome {
  if (iteration.action.kind === "abandon") return "abandoned";
  const outcome = iteration.outcome;
  // An iteration whose outcome was never appraised (the session ended on it)
  // is reported as no_change rather than guessed at.
  if (!outcome) return "no_change";
  if (outcome.errorPerceived) return "error";
  if (!outcome.screenChanged && iteration.prediction.expectsChange) return "no_change";
  // Half the prediction's signals missing is the threshold at which EVE's own
  // appraisal starts driving frustration, so it is where "surprise" begins.
  if (outcome.surprise >= 0.5) return "surprise";
  return "success";
}

/** Mint a CP/1 event. `actor` is fixed by the event kind, never by the caller. */
export function event(options: {
  kind: EventKind;
  subjectId: string;
  subjectType: SubjectType;
  correlationId: string;
  causationId?: string;
  payload?: Readonly<Record<string, PayloadValue>>;
  origin: string;
  derivedFrom?: readonly string[];
}): CpEvent {
  const document: CpEvent = {
    cp: "cp1",
    type: options.kind,
    id: randomUUID(),
    occurred_at: timestamp(),
    actor: EVENT_EMITTER[options.kind],
    subject_id: options.subjectId,
    subject_type: options.subjectType,
    correlation_id: options.correlationId,
    ...(options.causationId === undefined ? {} : { causation_id: options.causationId }),
    payload: options.payload ?? {},
    provenance: provenance({
      authoredBy: EVENT_EMITTER[options.kind],
      origin: options.origin,
      derivedFrom: options.derivedFrom,
    }),
  };
  return seal(document as unknown as Record<string, unknown>) as unknown as CpEvent;
}

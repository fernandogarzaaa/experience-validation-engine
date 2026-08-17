/**
 * Registries for vocabularies that used to be closed unions.
 *
 * `ScoreDimension`, `FindingCategory` and (CP/1's) `ExperienceAction` were
 * hand-written union types: adding a value meant editing core files and every
 * `Record<Union, …>` consumer. They are now backed by registries — the
 * shipped values are pre-registered as built-ins (so existing consumers see
 * no change), and domain packs and plugins can register new entries at
 * runtime without touching core.
 *
 * The registry pattern follows the existing scenario registry
 * (`src/fitness/scenarios.ts`): a module-level instance with `register` /
 * `list` / `require` functions, and failure on unknown ids rather than
 * silent skipping.
 *
 * Two invariants survive registry-ization unchanged:
 *
 * - **Evidence is mandatory.** Every score deduction and finding still cites
 *   the events that caused it. Registry entries carry
 *   `evidenceRequired: true` as a type-level literal so a new domain cannot
 *   register a vibes-based dimension.
 * - **The CP/1 wire is untouched.** Registered values serialize as strings,
 *   exactly like the built-ins did, so document bytes and content hashes are
 *   unchanged. New action verbs in particular are engine-side only
 *   ({@link ActionVerbEntry.onCp1Wire}); widening the canonical CP/1 verb set
 *   is a protocol change (SPEC §8), not a registration.
 */

/**
 * Perceptual modality a registry entry is meaningful for. Mirrors
 * `SurfaceCapabilities.modality` (`src/surface/capabilities.ts`) — kept as a
 * local alias because `core` depends on nothing.
 */
export type Modality = "visual" | "textual";

/** Every modality current surfaces can declare; the default `appliesTo`. */
export const ALL_MODALITIES: readonly Modality[] = ["visual", "textual"];

export interface RegistryEntry {
  /**
   * Serialized identifier. For built-ins this is exactly the string the old
   * closed union produced, so stored reports and fixtures keep matching.
   */
  readonly id: string;
  /** True for the values that shipped before the registry existed. */
  readonly builtin: boolean;
  readonly description?: string;
}

/** A score dimension: one axis of the 0..100 evidence-backed score vector. */
export interface ScoreDimensionEntry extends RegistryEntry {
  /**
   * Weight in the built-in `overall` composite (0 = reported but not
   * composited). Informational: the scorer remains the single source of
   * composite weights in Phase 0, so registering a dimension can never
   * silently reweight existing scores.
   */
  readonly weight: number;
  /** Modalities the dimension is meaningful on. */
  readonly appliesTo: readonly Modality[];
  /** Every deduction must cite evidence. Literal `true` — not negotiable. */
  readonly evidenceRequired: true;
}

/** A finding category: the kind of problem a {@link Finding} reports. */
export interface FindingCategoryEntry extends RegistryEntry {
  readonly appliesTo: readonly Modality[];
  /** Every finding must cite evidence. Literal `true` — not negotiable. */
  readonly evidenceRequired: true;
  /**
   * Phase 2: the score dimension findings in this category deduct from, when
   * the dimension is scored by the generic registered-dimension rule
   * (`src/scoring/scorer.ts`). Built-in categories leave this unset — the
   * sixteen built-in dimensions are still computed by name, unchanged.
   */
  readonly scoresInto?: string;
}

/**
 * An action verb an operator can perform. The nine built-ins are the CP/1
 * canonical set; verbs registered later are engine-side only.
 */
export interface ActionVerbEntry extends RegistryEntry {
  readonly appliesTo: readonly Modality[];
  /**
   * True only for the closed CP/1 canonical verb set (`ExperienceAction`).
   * Registration always produces `false`: putting a new verb on the wire
   * changes the canonical form, which SPEC §8 reserves for a protocol
   * version change.
   */
  readonly onCp1Wire: boolean;
}

/**
 * A named, string-keyed registry with fail-loud semantics: duplicates and
 * unknown lookups are errors, never silent no-ops.
 */
export class EveRegistry<TEntry extends RegistryEntry> {
  private readonly entries = new Map<string, TEntry>();

  constructor(private readonly kind: string) {}

  /**
   * Add an entry. Re-registering an id is rejected — replacing a built-in
   * would change the meaning of stored reports that already reference it.
   */
  register(entry: TEntry): void {
    if (this.entries.has(entry.id)) {
      throw new Error(`${this.kind} "${entry.id}" is already registered`);
    }
    this.entries.set(entry.id, entry);
  }

  get(id: string): TEntry | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Resolve an id, failing loudly on unknown ones (like `resolveScenarios`). */
  require(id: string): TEntry {
    const entry = this.entries.get(id);
    if (!entry) {
      throw new Error(
        `unknown ${this.kind} "${id}"; registered ids are ${[...this.entries.keys()].join(", ")}`,
      );
    }
    return entry;
  }

  list(): readonly TEntry[] {
    return [...this.entries.values()];
  }

  /** Entries meaningful on the given modality (`appliesTo` gating). */
  listFor(modality: Modality): readonly TEntry[] {
    return this.list().filter((entry) => {
      const appliesTo = (entry as { readonly appliesTo?: readonly Modality[] }).appliesTo;
      return appliesTo === undefined || appliesTo.includes(modality);
    });
  }
}

/**
 * The registries a plugin may extend. Passed to `EvePlugin.onRegister` —
 * the one moment a plugin is allowed to widen a vocabulary.
 */
export interface EveRegistries {
  readonly dimensions: EveRegistry<ScoreDimensionEntry>;
  readonly findingCategories: EveRegistry<FindingCategoryEntry>;
  readonly actionVerbs: EveRegistry<ActionVerbEntry>;
}

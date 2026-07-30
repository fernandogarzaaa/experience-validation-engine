import type { BrowserAdapter } from "../browser/adapter.js";
import { EveSession, type SessionResult } from "../engine/session.js";
import { InMemoryStore, type PersistentMemory } from "../memory/longTerm.js";
import type { Persona } from "../personas/persona.js";
import type { EvePlugin } from "../plugins/plugin.js";

/**
 * Collaborative sessions.
 *
 * Real work is rarely solo: a form is filled by one person and approved by
 * another; a document passes through a chain of roles; a task is handed off
 * mid-flow. This orchestrator runs a sequence of operators against the same
 * application, modeling handoffs and approval chains. Operators optionally
 * share long-term memory (institutional knowledge transfer) and each receives
 * a "baton" describing what the previous operator accomplished — so a
 * downstream role acts with awareness of upstream work.
 *
 * Permission boundaries are expressed as per-role goals and start points; the
 * orchestrator records where handoffs succeeded or broke down.
 */

export interface CollaborativeRole {
  readonly name: string;
  readonly persona: Persona | string;
  readonly goal: string;
  readonly goalSuccessSignals?: readonly string[];
  /** Where this role begins; defaults to where the previous role ended. */
  readonly startUrl?: string;
  /** Max steps for this role. */
  readonly maxSteps?: number;
  readonly plugins?: readonly EvePlugin[];
}

export interface CollaborativeScenario {
  readonly name: string;
  /** Factory so each role gets a fresh adapter over the same underlying app. */
  readonly adapterFactory: () => BrowserAdapter;
  readonly startUrl: string;
  readonly roles: readonly CollaborativeRole[];
  /** Share long-term memory across roles (knowledge transfer). Default true. */
  readonly sharedMemory?: boolean;
  readonly seed?: number | string;
  readonly cognitive?: boolean;
}

export interface Handoff {
  readonly from: string;
  readonly to: string;
  /** Did the upstream role complete its goal before handing off? */
  readonly upstreamCompleted: boolean;
  /** The screen the baton was passed at. */
  readonly atUrl: string;
  readonly note: string;
}

export interface CollaborativeResult {
  readonly scenario: string;
  readonly roleResults: Array<{ role: string; result: SessionResult }>;
  readonly handoffs: readonly Handoff[];
  /** Did the whole chain complete (every role achieved its goal)? */
  readonly chainCompleted: boolean;
  /** Where the chain first broke down, if it did. */
  readonly breakdown: { role: string; reason: string } | null;
  readonly summary: string;
}

/**
 * Run a collaborative scenario end-to-end.
 */
export async function runCollaborative(
  scenario: CollaborativeScenario,
): Promise<CollaborativeResult> {
  if (scenario.roles.length === 0)
    throw new Error("A collaborative scenario needs at least one role");
  const sharedMemory: PersistentMemory | undefined =
    (scenario.sharedMemory ?? true) ? new InMemoryStore() : undefined;

  const roleResults: CollaborativeResult["roleResults"] = [];
  const handoffs: Handoff[] = [];
  let breakdown: CollaborativeResult["breakdown"] = null;
  let lastEndUrl = scenario.startUrl;
  let lastRole: CollaborativeRole | null = null;
  let lastResult: SessionResult | null = null;

  for (let i = 0; i < scenario.roles.length; i++) {
    const role = scenario.roles[i]!;
    const startUrl = role.startUrl ?? lastEndUrl;

    // Record the handoff from the previous role.
    if (lastRole && lastResult) {
      handoffs.push({
        from: lastRole.name,
        to: role.name,
        upstreamCompleted: lastResult.goalAchieved,
        atUrl: lastEndUrl,
        note: lastResult.goalAchieved
          ? `${lastRole.name} completed "${lastRole.goal}" and handed off to ${role.name}.`
          : `${lastRole.name} did NOT complete "${lastRole.goal}" before handing off — ${role.name} may be blocked.`,
      });
      if (!lastResult.goalAchieved && !breakdown) {
        breakdown = {
          role: lastRole.name,
          reason: `${lastRole.name} could not complete their step (${lastResult.endReason}), stalling the chain.`,
        };
      }
    }

    const session = new EveSession({
      adapter: scenario.adapterFactory(),
      startUrl,
      persona: role.persona,
      goal: role.goal,
      goalSuccessSignals: role.goalSuccessSignals,
      seed: scenario.seed !== undefined ? `${String(scenario.seed)}:${role.name}` : undefined,
      maxSteps: role.maxSteps ?? 40,
      paceScale: 0,
      cognitive: scenario.cognitive ?? false,
      longTermMemory: sharedMemory,
      plugins: role.plugins,
    });
    const result = await session.run();
    roleResults.push({ role: role.name, result });

    // The next role begins where this one ended (its last visited URL).
    lastEndUrl = result.iterations[result.iterations.length - 1]?.url ?? startUrl;
    lastRole = role;
    lastResult = result;
  }

  const chainCompleted = roleResults.every((r) => r.result.goalAchieved);
  const summary = buildSummary(scenario.name, roleResults, handoffs, chainCompleted, breakdown);

  return {
    scenario: scenario.name,
    roleResults,
    handoffs,
    chainCompleted,
    breakdown,
    summary,
  };
}

function buildSummary(
  name: string,
  roleResults: CollaborativeResult["roleResults"],
  handoffs: readonly Handoff[],
  chainCompleted: boolean,
  breakdown: CollaborativeResult["breakdown"],
): string {
  const roles = roleResults.map((r) => r.role).join(" → ");
  if (chainCompleted) {
    return `Collaborative scenario "${name}" completed end-to-end across ${roleResults.length} role(s): ${roles}. All ${handoffs.length} handoff(s) succeeded.`;
  }
  const failedHandoffs = handoffs.filter((h) => !h.upstreamCompleted).length;
  return (
    `Collaborative scenario "${name}" broke down${breakdown ? ` at "${breakdown.role}": ${breakdown.reason}` : ""}. ` +
    `${failedHandoffs} of ${handoffs.length} handoff(s) passed incomplete work downstream — a shared-workflow failure functional tests would miss.`
  );
}

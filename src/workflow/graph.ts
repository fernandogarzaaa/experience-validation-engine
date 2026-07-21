import type { Percept } from "../core/types.js";
import { screenSignature } from "../memory/memory.js";
import { detectWorkflow } from "./detector.js";
import type { WorkflowKind } from "./catalog.js";

/**
 * The discovered workflow map of the product: which workflow-classified
 * screens exist and how the operator moved between them. Built passively
 * while the operator explores; consumed by scoring and reporting.
 */

export interface WorkflowNode {
  readonly signature: string;
  url: string;
  title: string;
  kind: WorkflowKind;
  kindConfidence: number;
  visits: number;
  /** Steps at which the operator perceived an error on this screen. */
  errorSteps: number[];
  firstSeenStep: number;
}

export interface WorkflowTransition {
  readonly from: string;
  readonly to: string;
  readonly via: string;
  count: number;
}

export interface DiscoveredWorkflow {
  readonly kind: WorkflowKind;
  readonly screens: readonly WorkflowNode[];
  /** Did the operator reach a confirmation/terminal screen for it? */
  readonly completed: boolean;
  readonly errorCount: number;
}

export class WorkflowGraph {
  private readonly nodes = new Map<string, WorkflowNode>();
  private readonly transitions = new Map<string, WorkflowTransition>();
  private lastSignature: string | null = null;

  observe(percept: Percept, step: number, arrivedVia: string | null, errorPerceived: boolean): WorkflowNode {
    const signature = screenSignature(percept);
    let node = this.nodes.get(signature);
    const match = detectWorkflow(percept);
    if (!node) {
      node = {
        signature,
        url: percept.url,
        title: percept.title,
        kind: match.kind,
        kindConfidence: match.confidence,
        visits: 0,
        errorSteps: [],
        firstSeenStep: step,
      };
      this.nodes.set(signature, node);
    } else if (match.confidence > node.kindConfidence) {
      node.kind = match.kind;
      node.kindConfidence = match.confidence;
    }
    node.visits += 1;
    node.url = percept.url;
    node.title = percept.title;
    if (errorPerceived) node.errorSteps.push(step);

    if (this.lastSignature && this.lastSignature !== signature && arrivedVia) {
      const key = `${this.lastSignature}=>${signature}`;
      const existing = this.transitions.get(key);
      if (existing) existing.count += 1;
      else this.transitions.set(key, { from: this.lastSignature, to: signature, via: arrivedVia, count: 1 });
    }
    this.lastSignature = signature;
    return node;
  }

  allNodes(): readonly WorkflowNode[] {
    return [...this.nodes.values()];
  }

  allTransitions(): readonly WorkflowTransition[] {
    return [...this.transitions.values()];
  }

  /**
   * Group discovered screens into workflows and judge completion: a workflow
   * counts as completed when the operator both entered it and subsequently
   * reached a confirmation-like screen or returned to a dashboard.
   */
  discoveredWorkflows(): readonly DiscoveredWorkflow[] {
    const byKind = new Map<WorkflowKind, WorkflowNode[]>();
    for (const node of this.nodes.values()) {
      if (node.kind === "unknown") continue;
      const list = byKind.get(node.kind) ?? [];
      list.push(node);
      byKind.set(node.kind, list);
    }
    const confirmationSigs = new Set(
      [...this.nodes.values()]
        .filter((n) => n.kind === "confirmation" || n.kind === "dashboard")
        .map((n) => n.signature),
    );
    const result: DiscoveredWorkflow[] = [];
    for (const [kind, screens] of byKind) {
      if (kind === "confirmation") continue;
      const completed = screens.some((screen) =>
        [...this.transitions.values()].some(
          (t) => t.from === screen.signature && confirmationSigs.has(t.to),
        ),
      );
      const errorCount = screens.reduce((n, s) => n + s.errorSteps.length, 0);
      result.push({ kind, screens, completed, errorCount });
    }
    return result.sort((a, b) => a.kind.localeCompare(b.kind));
  }

  /** Fraction of discovered screens revisited more than twice (wandering). */
  revisitRatio(): number {
    const nodes = this.allNodes();
    if (nodes.length === 0) return 0;
    return nodes.filter((n) => n.visits > 2).length / nodes.length;
  }
}

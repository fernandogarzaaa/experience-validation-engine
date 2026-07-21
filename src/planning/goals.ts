import { tokenize } from "../cognition/mentalModel.js";

/**
 * Goal management.
 *
 * The operator always has a current goal ("sign up for an account", "explore
 * the application") and may push transient subgoals ("dismiss this cookie
 * banner", "recover from this error"). Goals carry keywords that drive
 * salience, and satisfaction signals that let the engine detect completion
 * from perception alone.
 */

export type GoalStatus = "active" | "achieved" | "abandoned";

export interface Goal {
  readonly id: string;
  readonly description: string;
  /** Keywords that make screen elements goal-relevant. */
  readonly keywords: readonly string[];
  /** Signals whose appearance on screen suggests the goal is achieved. */
  readonly successSignals: readonly string[];
  status: GoalStatus;
  /** Steps spent pursuing this goal. */
  effortSteps: number;
  readonly priority: number;
}

let goalCounter = 0;

/**
 * Conventional associations a software user carries: pursuing "reset my
 * password" makes "Log in" relevant, pursuing "export" makes "Settings"
 * relevant, and so on. Applied when deriving keywords from a goal
 * description so salience reflects human semantic knowledge, not just
 * string overlap.
 */
const KEYWORD_ASSOCIATIONS: Readonly<Record<string, readonly string[]>> = {
  password: ["log", "login", "account", "forgot", "sign"],
  login: ["log", "sign", "account", "email"],
  account: ["sign", "login", "profile", "settings"],
  signup: ["sign", "register", "started", "create"],
  register: ["sign", "started", "create"],
  buy: ["pricing", "checkout", "cart", "plans"],
  purchase: ["pricing", "checkout", "cart"],
  subscribe: ["pricing", "plans", "billing"],
  export: ["settings", "download", "data"],
  import: ["settings", "upload", "data"],
  notification: ["settings", "preferences", "alerts"],
  profile: ["account", "settings", "avatar"],
  search: ["find", "filter"],
  help: ["support", "docs", "faq", "contact"],
  cancel: ["settings", "account", "billing", "subscription"],
};

function expandKeywords(base: readonly string[]): readonly string[] {
  const expanded = new Set(base);
  for (const keyword of base) {
    for (const assoc of KEYWORD_ASSOCIATIONS[keyword] ?? []) expanded.add(assoc);
  }
  return [...expanded];
}

export function createGoal(
  description: string,
  options: {
    keywords?: readonly string[];
    successSignals?: readonly string[];
    priority?: number;
  } = {},
): Goal {
  goalCounter += 1;
  return {
    id: `goal-${goalCounter}`,
    description,
    keywords: options.keywords ?? expandKeywords(tokenize(description)),
    successSignals: options.successSignals ?? [],
    status: "active",
    effortSteps: 0,
    priority: options.priority ?? 1,
  };
}

export class GoalStack {
  private readonly stack: Goal[] = [];
  private readonly completed: Goal[] = [];

  constructor(root: Goal) {
    this.stack.push(root);
  }

  get current(): Goal {
    const top = this.stack[this.stack.length - 1];
    if (!top) throw new Error("Goal stack is empty");
    return top;
  }

  get root(): Goal {
    const bottom = this.stack[0] ?? this.completed[0];
    if (!bottom) throw new Error("Goal stack is empty");
    return bottom;
  }

  /** The current subgoal, if the operator has pushed one atop the root. */
  get subgoal(): Goal | null {
    return this.stack.length > 1 ? this.current : null;
  }

  push(goal: Goal): void {
    this.stack.push(goal);
  }

  /** Mark the current goal resolved and pop it (root goal is never popped). */
  resolve(status: Exclude<GoalStatus, "active">): void {
    const top = this.current;
    top.status = status;
    if (this.stack.length > 1) {
      this.stack.pop();
      this.completed.push(top);
    }
  }

  tickEffort(): void {
    this.current.effortSteps += 1;
  }

  history(): readonly Goal[] {
    return [...this.completed, ...this.stack];
  }

  depth(): number {
    return this.stack.length;
  }
}

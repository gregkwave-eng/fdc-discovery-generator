// ---------------------------------------------------------------------------
// FDC Stage 3 — Scenario archetype library (Phase 2)
//
// An *archetype* is a reusable probe pattern that, when instantiated against a
// specific client's context (S2 transcript + Stack Census + Hypothesis Brief),
// becomes a concrete scenario vignette the owner reacts to. Archetypes are keyed
// by business type + Stack Census signals and map 1:1 onto the idiosyncrasy
// ledger categories so a reaction can be tagged downstream.
//
// Selection is deterministic (this file) so it's unit-testable; only the
// *instantiation* of an archetype into prose is delegated to the LLM.
// ---------------------------------------------------------------------------

export type LedgerCategory =
  | "process-exception"
  | "tool-attachment"
  | "terminology"
  | "compliance/edge-case"
  | "customer-handling"
  | "pricing/commercial"
  | "data-shape"
  | "trust/control";

export type Severity = "high" | "med" | "low";

// A precondition gate: only offer this archetype when the client context has the
// relevant signal, so we never probe (e.g.) tool-attachment on an empty stack.
export type Requires = "mustKeep" | "replaceHard" | "hypotheses" | null;

export interface Archetype {
  key: string;
  category: LedgerCategory;
  label: string;
  appliesTo: "any" | string[]; // business-type keywords (matched loosely / case-insensitive)
  requires: Requires;
  severityHint: Severity;
  priority: number; // lower = stronger candidate
  seed: string; // instruction for the LLM to instantiate this into a grounded vignette
}

export interface ClientContext {
  name: string;
  businessType: string;
  stackMustKeep: string[];
  stackReplaceEasy: string[];
  stackReplaceHard: string[];
  hypotheses: string[]; // plain-language hypotheses from the Hypothesis Brief
}

export interface DepthPlan {
  total: number;
  wildcards: number;
}

export const DEPTH_PLANS: Record<"light" | "standard" | "deep", DepthPlan> = {
  light: { total: 5, wildcards: 1 },
  standard: { total: 8, wildcards: 1 },
  deep: { total: 12, wildcards: 2 },
};

// The library. Core archetypes (appliesTo "any") cover all 8 ledger categories;
// the rest are business-type / signal specific. Keep seeds tight — the LLM
// grounds them in the real transcript + stack at instantiation time.
export const ARCHETYPES: Archetype[] = [
  // --- core, universal --------------------------------------------------------
  {
    key: "process-exception.edge-of-workflow",
    category: "process-exception",
    label: "The undocumented exception",
    appliesTo: "any",
    requires: null,
    severityHint: "high",
    priority: 1,
    seed: "Construct a realistic edge case that sits just outside this owner's normal documented workflow — the kind of thing an SOP wouldn't cover but happens often enough that they have an unwritten rule. Surface how THEY personally handle it.",
  },
  {
    key: "trust/control.automation-handoff",
    category: "trust/control",
    label: "What they'd never let software decide",
    appliesTo: "any",
    requires: null,
    severityHint: "high",
    priority: 2,
    seed: "Pose a scenario where a system could automate a judgement call this owner currently makes by gut/experience. Probe the exact line they would NOT let software cross, and why.",
  },
  {
    key: "tool-attachment.rip-and-replace",
    category: "tool-attachment",
    label: "Replacing a must-keep tool",
    appliesTo: "any",
    requires: "mustKeep",
    severityHint: "high",
    priority: 2,
    seed: "Propose calmly migrating away from one of their stated must-keep tools to a 'better' consolidated system. Probe the real reason it's load-bearing — the workflow, data, or trust wired around it that a migration would break.",
  },
  {
    key: "customer-handling.difficult-customer",
    category: "customer-handling",
    label: "The customer who breaks the rules",
    appliesTo: "any",
    requires: null,
    severityHint: "med",
    priority: 3,
    seed: "Describe a difficult or non-standard customer situation specific to their business. Probe the discretion, escalation, and judgement they apply that a generic CRM flow would flatten.",
  },
  {
    key: "pricing/commercial.discount-judgement",
    category: "pricing/commercial",
    label: "The pricing judgement call",
    appliesTo: "any",
    requires: null,
    severityHint: "med",
    priority: 3,
    seed: "Construct a quoting / pricing / discount decision where the 'right' number isn't on any rate card. Probe the heuristics, relationships, and exceptions that drive their real pricing.",
  },
  {
    key: "data-shape.messy-record",
    category: "data-shape",
    label: "How the data really looks",
    appliesTo: "any",
    requires: null,
    severityHint: "med",
    priority: 4,
    seed: "Present an idealized clean data record for their domain and ask them to correct it to reality — the missing fields, the free-text dumping grounds, the one column everyone misuses. Surface the true shape of their records.",
  },
  {
    key: "terminology.what-do-you-call-it",
    category: "terminology",
    label: "Their private vocabulary",
    appliesTo: "any",
    requires: null,
    severityHint: "low",
    priority: 5,
    seed: "Use a deliberately generic industry term for something this owner clearly has their own name/process for. Probe the local vocabulary and the distinction the generic term erases.",
  },
  {
    key: "compliance/edge-case.regulatory-line",
    category: "compliance/edge-case",
    label: "The compliance / liability edge",
    appliesTo: "any",
    requires: null,
    severityHint: "high",
    priority: 2,
    seed: "Construct a scenario at the edge of a regulatory, warranty, contractual, or liability boundary relevant to their trade. Probe the exact wording, sign-off, or paper trail they will not deviate from. Capture any mandated text verbatim if they cite it.",
  },
  {
    key: "process-exception.rush-job",
    category: "process-exception",
    label: "When the timeline collapses",
    appliesTo: "any",
    requires: null,
    severityHint: "med",
    priority: 4,
    seed: "Drop a rush / emergency job into their normal process. Probe which steps they keep sacred and which they'll bend under time pressure — that reveals what's truly load-bearing vs ceremony.",
  },
  {
    key: "tool-attachment.shadow-spreadsheet",
    category: "tool-attachment",
    label: "The spreadsheet that runs the business",
    appliesTo: "any",
    requires: null,
    severityHint: "med",
    priority: 4,
    seed: "Probe for the off-system spreadsheet, whiteboard, notebook, or text-thread that actually coordinates the work despite the 'official' tools. Surface what it tracks and why it never moved into a real system.",
  },
  {
    key: "trust/control.handoff-blindspot",
    category: "trust/control",
    label: "What breaks when they're out",
    appliesTo: "any",
    requires: null,
    severityHint: "med",
    priority: 5,
    seed: "Describe the owner being unreachable for a week. Probe which decision or knowledge only lives in their head — the single point of failure a system would need to encode but currently can't.",
  },
  {
    key: "data-shape.status-that-isnt-binary",
    category: "data-shape",
    label: "The status with no clean value",
    appliesTo: "any",
    requires: null,
    severityHint: "med",
    priority: 5,
    seed: "Pick a job/order/lead 'status' and propose a tidy dropdown of values. Probe the in-between states reality actually has that don't fit a clean enum — and how they track them today.",
  },
  // --- hypothesis-driven ------------------------------------------------------
  {
    key: "process-exception.hypothesis-probe",
    category: "process-exception",
    label: "Test the brief's assumption",
    appliesTo: "any",
    requires: "hypotheses",
    severityHint: "high",
    priority: 1,
    seed: "Take one hypothesis from the Hypothesis Brief and design a scenario whose owner reaction will clearly CONFIRM or CONTRADICT it. Do not telegraph the hypothesis; let their behaviour reveal it.",
  },
];

// Loose, case-insensitive match of a business type against an archetype's appliesTo.
function appliesToBusiness(a: Archetype, businessType: string): boolean {
  if (a.appliesTo === "any") return true;
  const bt = businessType.toLowerCase();
  return a.appliesTo.some((k) => bt.includes(k.toLowerCase()) || k.toLowerCase().includes(bt));
}

function requirementMet(a: Archetype, ctx: ClientContext): boolean {
  switch (a.requires) {
    case "mustKeep":
      return ctx.stackMustKeep.length > 0;
    case "replaceHard":
      return ctx.stackReplaceHard.length > 0;
    case "hypotheses":
      return ctx.hypotheses.length > 0;
    case null:
      return true;
    default:
      return true;
  }
}

export interface SelectedArchetype {
  archetype: Archetype | null; // null => wildcard slot
  isWildcard: boolean;
}

/**
 * Deterministically select archetypes for a session. Guarantees:
 * - only applicable archetypes (business type + required signal present),
 * - category diversity via round-robin (no category dominates),
 * - priority-ordered within a category,
 * - exactly DEPTH_PLANS[tier].wildcards reserved wildcard slots at the end.
 */
export function selectArchetypes(
  ctx: ClientContext,
  tier: "light" | "standard" | "deep",
): SelectedArchetype[] {
  const plan = DEPTH_PLANS[tier];
  const slots = Math.max(0, plan.total - plan.wildcards);

  const eligible = ARCHETYPES.filter(
    (a) => appliesToBusiness(a, ctx.businessType) && requirementMet(a, ctx),
  ).sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));

  // Round-robin across categories for diversity.
  const byCategory = new Map<string, Archetype[]>();
  for (const a of eligible) {
    if (!byCategory.has(a.category)) byCategory.set(a.category, []);
    byCategory.get(a.category)!.push(a);
  }
  const categories = [...byCategory.keys()];

  const picked: Archetype[] = [];
  let i = 0;
  while (picked.length < slots && categories.some((c) => byCategory.get(c)!.length > 0)) {
    const cat = categories[i % categories.length];
    const bucket = byCategory.get(cat)!;
    if (bucket.length > 0) picked.push(bucket.shift()!);
    i++;
  }

  const selected: SelectedArchetype[] = picked.map((a) => ({ archetype: a, isWildcard: false }));
  for (let w = 0; w < plan.wildcards; w++) {
    selected.push({ archetype: null, isWildcard: true });
  }
  return selected;
}

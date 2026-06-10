export const APP_NAME = "Litmus";

// ---------------------------------------------------------------------------
// §5 Research enrichment flags (R-phase). Module constants (same provable-OFF
// pattern as review.ts OWNER_EMAIL_ENABLED) — flipping is a one-line change +
// deploy, so the gate state is always visible in source, not hidden in env.
// ---------------------------------------------------------------------------

// Master switch. While FALSE, scenario generation behaves EXACTLY as before
// (no brief is ever read). Flip TRUE only once Gate-1 vetting is trusted.
export const RESEARCH_GROUNDING_ENABLED = false;

// §5: Greg is the SOLE Gate-1 approver (Graham + Lyle have visibility only).
export const RESEARCH_APPROVER_EMAIL = "greg@frankdataconsultants.com";

// §5 locked: public-web research only (no paid firmographics).
export const RESEARCH_SCOPE = "public-web" as const;

// Build the grounding block injected into the scenario-generation user prompt
// from a vetted brief. Verified vs inference is surfaced EXPLICITLY so the model
// uses sourced facts confidently and treats inferences as hypotheses to probe —
// and so a probe never asserts an inference to the owner as established fact.
export function buildResearchGroundingBlock(brief: {
  title: string;
  summary: string;
  findings: Array<{ topic: string; claim: string; kind: "verified" | "inference"; relevance?: string }>;
}): string {
  const lines: string[] = [
    "VETTED INDUSTRY RESEARCH (human-approved; use it to make probes sharper and more",
    "industry-relevant — NOT to state as fact to the owner). Items marked [VERIFIED] are",
    "publicly sourced; items marked [INFERENCE] are reasoned guesses — treat those as",
    "hypotheses worth probing, never as established truth:",
    `  Brief: ${brief.title}${brief.summary ? ` — ${brief.summary}` : ""}`,
  ];
  for (const f of brief.findings) {
    const tag = f.kind === "verified" ? "VERIFIED" : "INFERENCE";
    const rel = f.relevance ? ` (why it matters: ${f.relevance})` : "";
    lines.push(`  - [${tag}] (${f.topic}) ${f.claim}${rel}`);
  }
  return lines.join("\n");
}

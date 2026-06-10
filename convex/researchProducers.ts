// ---------------------------------------------------------------------------
// FDC Stage 3 — Research producer seam (§5 R-phase, R0)
//
// A *researchProducer* converts some NATIVE research output (e.g. a Claude
// deep-research markdown doc) into the normalized brief contract the rest of the
// system consumes. Producers are pure + deterministic (this file, no IO, no
// convex imports) so they are unit-testable; selecting one is by id, so adding a
// new research source = registering one ResearchProducer with zero downstream
// change. The normalize step is where verified-vs-inference + sources get
// enforced — that distinction is non-negotiable (§5).
//
// R0 ships the seam + the `manual` producer (structured pass-through, fully
// usable + testable). R1 adds `claude-deep-research` (markdown -> findings).
// ---------------------------------------------------------------------------

export type ResearchFindingKind = "verified" | "inference";

export interface NormalizedFinding {
  id: string;
  topic: string;
  claim: string;
  kind: ResearchFindingKind;
  sources: string[];
  relevance?: string;
}

export interface NormalizedBrief {
  title: string;
  summary: string;
  findings: NormalizedFinding[];
  ownerResearchIncluded: boolean;
}

export interface ResearchProducer {
  id: string;
  label: string;
  /** Pure: native payload (+ optional hints) -> normalized brief. No IO. */
  normalize(raw: string, hints?: Record<string, unknown>): NormalizedBrief;
}

export class ResearchProducerError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ResearchProducerError";
  }
}

// --- shared normalization rules --------------------------------------------
// Applied by EVERY producer so the contract is uniform regardless of source.
//   * assign stable ids (f1, f2, …) when missing,
//   * trim text, drop empty findings,
//   * a finding tagged "verified" with NO source is DOWNGRADED to "inference"
//     (we never present an unsourced claim as verified — §5 non-negotiable).
export function normalizeFindings(
  raw: Array<Partial<NormalizedFinding>>,
): { findings: NormalizedFinding[]; downgraded: number } {
  let downgraded = 0;
  const findings: NormalizedFinding[] = [];
  for (const f of raw) {
    const claim = (f.claim ?? "").trim();
    if (!claim) continue;
    const sources = (f.sources ?? []).map((s) => String(s).trim()).filter(Boolean);
    let kind: ResearchFindingKind = f.kind === "verified" ? "verified" : "inference";
    if (kind === "verified" && sources.length === 0) {
      kind = "inference"; // can't be verified without a source
      downgraded++;
    }
    findings.push({
      id: (f.id ?? "").trim() || `f${findings.length + 1}`,
      topic: (f.topic ?? "general").trim(),
      claim,
      kind,
      sources,
      relevance: f.relevance?.trim() || undefined,
    });
  }
  return { findings, downgraded };
}

// --- manual producer (R0): structured JSON pass-through ---------------------
// `raw` is a JSON string: { title, summary, ownerResearchIncluded, findings:[…] }.
// Used for direct/hand-curated imports and as the seam's reference implementation.
const manualProducer: ResearchProducer = {
  id: "manual",
  label: "Manual structured import",
  normalize(raw: string): NormalizedBrief {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new ResearchProducerError("manual producer expects a JSON payload");
    }
    const rawFindings = Array.isArray(parsed.findings)
      ? (parsed.findings as Array<Partial<NormalizedFinding>>)
      : [];
    const { findings } = normalizeFindings(rawFindings);
    if (findings.length === 0) {
      throw new ResearchProducerError("brief has no usable findings");
    }
    return {
      title: String(parsed.title ?? "Research brief").trim(),
      summary: String(parsed.summary ?? "").trim(),
      findings,
      ownerResearchIncluded: Boolean(parsed.ownerResearchIncluded),
    };
  },
};

// --- registry ---------------------------------------------------------------
const PRODUCERS: Record<string, ResearchProducer> = {
  [manualProducer.id]: manualProducer,
  // "claude-deep-research": claudeDeepResearchProducer,  // ← R1
};

export function getProducer(id: string): ResearchProducer {
  const p = PRODUCERS[id];
  if (!p) {
    throw new ResearchProducerError(
      `unknown research producer "${id}"; registered: ${Object.keys(PRODUCERS).join(", ")}`,
    );
  }
  return p;
}

export function listProducerIds(): string[] {
  return Object.keys(PRODUCERS);
}

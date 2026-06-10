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

// --- claude-deep-research producer (R1): extraction JSON -> findings ---------
// Native input is the STRUCTURED extraction emitted by the deep-research action
// (researchActions.runDeepResearch), which uses Claude to turn a deep-research
// markdown doc into a finding list. Findings reference citation ids; a top-level
// `citations` map resolves id -> source URL. This producer resolves those refs
// into inline sources, then applies the shared normalize rules — so any finding
// whose citation can't be resolved (or that cites nothing) is DOWNGRADED from
// "verified" to "inference". The LLM lives in the action (IO); this stays pure.
//
// Native shape:
//   { title, summary, ownerResearchIncluded,
//     citations: [{ id, url }],
//     findings: [{ topic, claim, kind, citations: [id…], sources?: [url…], relevance }] }
const claudeDeepResearchProducer: ResearchProducer = {
  id: "claude-deep-research",
  label: "Claude deep research",
  normalize(raw: string): NormalizedBrief {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new ResearchProducerError("claude-deep-research producer expects a JSON payload");
    }

    // citation registry: id -> url (http(s) only)
    const cites = new Map<string, string>();
    if (Array.isArray(parsed.citations)) {
      for (const c of parsed.citations as Array<Record<string, unknown>>) {
        const id = String(c?.id ?? "").trim();
        const url = String(c?.url ?? "").trim();
        if (id && /^https?:\/\//i.test(url)) cites.set(id, url);
      }
    }

    const rawFindings = Array.isArray(parsed.findings)
      ? (parsed.findings as Array<Record<string, unknown>>)
      : [];
    const pre: Array<Partial<NormalizedFinding>> = rawFindings.map((f) => {
      const ids = Array.isArray(f.citations) ? (f.citations as unknown[]).map((x) => String(x).trim()) : [];
      const resolved = ids.map((id) => cites.get(id)).filter((u): u is string => !!u);
      const inline = Array.isArray(f.sources) ? (f.sources as unknown[]).map((s) => String(s).trim()) : [];
      const sources = [...resolved, ...inline].filter((s) => /^https?:\/\//i.test(s));
      return {
        topic: f.topic as string | undefined,
        claim: f.claim as string | undefined,
        kind: (f.kind === "verified" ? "verified" : "inference") as ResearchFindingKind,
        sources,
        relevance: f.relevance as string | undefined,
      };
    });

    const { findings } = normalizeFindings(pre);
    if (findings.length === 0) {
      throw new ResearchProducerError("brief has no usable findings");
    }
    return {
      title: String(parsed.title ?? "Deep research brief").trim(),
      summary: String(parsed.summary ?? "").trim(),
      findings,
      ownerResearchIncluded: Boolean(parsed.ownerResearchIncluded),
    };
  },
};

// --- registry ---------------------------------------------------------------
const PRODUCERS: Record<string, ResearchProducer> = {
  [manualProducer.id]: manualProducer,
  [claudeDeepResearchProducer.id]: claudeDeepResearchProducer,
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

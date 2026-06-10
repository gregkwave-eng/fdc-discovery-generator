// ---------------------------------------------------------------------------
// FDC Stage 3 — Research producer ACTIONS (§5 R-phase, R1)
//
// Actions are the IO layer for the research seam: they call Claude, then hand
// the structured result to a PURE producer (researchProducers.ts) for the
// verified-vs-inference + source enforcement, and persist via the existing
// importResearchBrief mutation (so the brief lands PENDING for Gate-1 vetting).
//
// runDeepResearch: deep-research markdown DOC -> structured extraction (Claude)
// -> claude-deep-research producer -> pending brief. The extraction is held to
// the same discipline as the rest of the system: a claim is only "verified" if
// the DOC carries a source URL for it; everything else is "inference"; scope is
// public-web only. The producer + normalize layer downgrade defensively even if
// the model mislabels, so the human reviewer never sees an unsourced "verified".
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { anthropicMessage, extractJson, GEN_MODEL } from "./llm";
import { RESEARCH_SCOPE } from "./constants";

// Explicit return type — breaks the circular type-inference Convex hits when an
// action calls a mutation through the generated `api`.
type DeepResearchResult = {
  briefId: Id<"researchBriefs">;
  producer: string;
  findingCount: number;
  verifiedCount: number;
  inferenceCount: number;
  status: "pending";
  model: string;
  usage: { input_tokens?: number; output_tokens?: number } | null;
};

const EXTRACTION_SYSTEM = [
  "You convert a Claude deep-research document into a STRUCTURED research brief for",
  "FDC's discovery process. You extract; you do not invent. Use ONLY information present",
  "in the supplied document.",
  "",
  "Hard rules (non-negotiable):",
  `- SCOPE is ${RESEARCH_SCOPE}: only public-web-derived facts. Ignore anything that would`,
  "  require paid firmographics or non-public data.",
  "- VERIFIED vs INFERENCE is sacred. A finding is \"verified\" ONLY if the document gives a",
  "  concrete source URL (http/https) backing that specific claim. If a claim is reasoned,",
  "  generalized, or unsourced, it is \"inference\" — never label it verified.",
  "- Never present an inference as fact. When unsure, choose inference.",
  "- Owner research IS in scope when it is business-relevant (the owner as an operator);",
  "  set ownerResearchIncluded=true if any finding concerns the owner. Exclude purely",
  "  personal/sensitive details.",
  "- Each finding's `relevance` must say why it could shape a discovery probe.",
  "",
  "Output ONLY a JSON object (no prose, no markdown fence needed) of exactly this shape:",
  "{",
  '  "title": string,',
  '  "summary": string,',
  '  "ownerResearchIncluded": boolean,',
  '  "citations": [{ "id": string, "url": string }],   // every source URL found, given a short id',
  '  "findings": [',
  '    { "topic": string, "claim": string, "kind": "verified"|"inference",',
  '      "citations": [string], "relevance": string }   // citations = ids from the list above',
  "  ]",
  "}",
  "Keep 5-15 of the highest-signal findings. Deduplicate. Cite by id, not inline URL.",
].join("\n");

// Shared extraction: deep-research doc -> structured brief JSON (Claude call).
// Exported so the dev smoke test exercises the exact same prompt + parse path.
export async function extractBriefFromDoc(
  doc: string,
  model?: string,
): Promise<{ extraction: unknown; usage: { input_tokens?: number; output_tokens?: number } | null }> {
  const result = await anthropicMessage({
    system: EXTRACTION_SYSTEM,
    user:
      "Extract the structured brief from the deep-research document below.\n\n<document>\n" +
      doc.slice(0, 120000) +
      "\n</document>",
    model: model ?? GEN_MODEL,
    maxTokens: 4096,
    temperature: 0.2,
  });
  let extraction: unknown;
  try {
    extraction = extractJson(result.text);
  } catch (e) {
    throw new Error(`could not parse extraction JSON from model: ${(e as Error).message}`);
  }
  return { extraction, usage: result.usage };
}

export const runDeepResearch = action({
  args: {
    clientId: v.id("clients"),
    doc: v.string(), // the Claude deep-research markdown document
    importedBy: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<DeepResearchResult> => {
    const doc = args.doc.trim();
    if (doc.length < 40) {
      throw new Error("deep-research doc is empty or too short to extract from");
    }

    const { extraction, usage } = await extractBriefFromDoc(doc, args.model);

    // Persist through the pure producer + importResearchBrief (lands PENDING).
    const imported: Omit<DeepResearchResult, "model" | "usage"> = await ctx.runMutation(
      api.research.importResearchBrief, {
      clientId: args.clientId,
      producer: "claude-deep-research",
      raw: JSON.stringify(extraction),
      importedBy: args.importedBy ?? "claude-deep-research",
    });

    return { ...imported, model: args.model ?? GEN_MODEL, usage };
  },
});

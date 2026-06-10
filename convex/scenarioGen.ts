import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { assertSessionInTenant } from "./tenancy";
import { recordTransition } from "./transitions";
import {
  type ClientContext,
  type SelectedArchetype,
  DEPTH_PLANS,
  selectArchetypes,
} from "./archetypes";
import { anthropicMessage, extractJson, GEN_MODEL } from "./llm";
import { RESEARCH_GROUNDING_ENABLED, buildResearchGroundingBlock } from "./constants";
import { loadApprovedBrief } from "./research";

declare const process: { env: Record<string, string | undefined> };

// --- Diagnostics ------------------------------------------------------------
// Returns ONLY booleans (never values) for whether each expected secret is wired
// into this deployment's Convex env. This is the live env-wiring proof.
export const envCheck = query({
  args: {},
  handler: async () => {
    const keys = [
      "ANTHROPIC_API_KEY",
      "DEEPGRAM_API_KEY",
      "RESEND_API_KEY",
      "TURNSTILE_SECRET_KEY",
      "HMAC_SECRET",
    ];
    const present: Record<string, boolean> = {};
    for (const k of keys) present[k] = Boolean(process.env[k]);
    return { present, model: GEN_MODEL };
  },
});

// --- Internal context loader (tenant-scoped) --------------------------------
export const getGenerationContext = internalQuery({
  args: { clientId: v.id("clients"), sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    await assertSessionInTenant(ctx, args.clientId, args.sessionId);
    const client = await ctx.db.get(args.clientId);
    const session = await ctx.db.get(args.sessionId);
    if (!client || !session) throw new Error("client or session not found");
    // §5 flag-gated research grounding: only when the master flag is ON *and* a
    // Gate-1-approved brief exists. Default OFF => empty => prompt is unchanged
    // (fully backward-compatible with pre-R-phase behavior).
    let researchGrounding = "";
    if (RESEARCH_GROUNDING_ENABLED) {
      const brief = await loadApprovedBrief(ctx, args.clientId);
      if (brief) researchGrounding = buildResearchGroundingBlock(brief);
    }
    return {
      name: client.name,
      businessType: client.businessType,
      stackMustKeep: client.stackMustKeep,
      stackReplaceEasy: client.stackReplaceEasy,
      stackReplaceHard: client.stackReplaceHard,
      depthTier: session.depthTier,
      status: session.status,
      researchGrounding,
    };
  },
});

export const markSessionGenerated = internalMutation({
  args: { clientId: v.id("clients"), sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    await assertSessionInTenant(ctx, args.clientId, args.sessionId);
    // Audited transition draft->generated (or generated->generated on regen).
    await recordTransition(ctx, {
      sessionId: args.sessionId,
      to: "generated",
      action: "scenario_gen",
      actor: "system",
      auditNoop: true,
    });
  },
});

// --- Prompt construction ----------------------------------------------------
function buildSystemPrompt(): string {
  return [
    "You are FDC's Stage 3 Discovery scenario writer. You craft short, concrete, realistic",
    "scenario vignettes that a small-business OWNER reacts to, so we can surface the",
    "idiosyncrasies (unwritten rules, tool attachments, edge cases, judgement calls) that a",
    "generic software build would flatten.",
    "",
    "These are PROBE vignettes for discovery-by-reaction: a good one makes the owner go",
    "either \"yeah, that's exactly us\" OR \"no — but actually we do X\". BOTH reactions are wins;",
    "the goal is to surface their reality, not to predict their exact quirk. Aim for",
    "industry-relevant, resonance-inviting situations a real owner in this trade would recognise.",
    "",
    "Rules:",
    "- Ground EVERY scenario in this specific owner's real business, tools, and language from the",
    "  provided context. Mine the moments they ACTUALLY raised in the transcript — the specific",
    "  exceptions, hesitations, control-boundaries, and limits they named — before inventing any",
    "  plausible-but-generic situation. Use their actual tool names and terminology. No filler.",
    "- Spread the vignettes across the DIFFERENT distinct concerns the owner raised; do not",
    "  cluster several scenarios on the same theme.",
    "- Each vignette is 2-4 sentences: set a concrete situation, then end with one open question",
    "  that invites the owner to reveal HOW they personally handle it — explicitly inviting a",
    "  \"does this ring true, or what's different for you?\" reaction. Never multiple-choice.",
    "- Do not lecture, sell, or reference 'idiosyncrasies'/'the system'. Stay in their world.",
    "- If a VETTED INDUSTRY RESEARCH block is provided, use it to make probes more",
    "  industry-relevant and specific. Treat [VERIFIED] items as sourced facts you can lean on,",
    "  and [INFERENCE] items as hypotheses to PROBE (never assert an inference to the owner as",
    "  fact). Research sharpens the probe; the owner's reality is still the answer.",
    "- Wildcard slots: deliberately diverge from the listed probe — go somewhere the archetypes",
    "  don't, to catch a novel idiosyncrasy. Still grounded in their business.",
    "- Return STRICT JSON only: an array of objects {slot:number, title:string, body:string}.",
    "  One object per requested slot, in order. title <= 8 words. No prose outside the JSON.",
  ].join("\n");
}

function buildUserPrompt(
  cc: ClientContext,
  selected: SelectedArchetype[],
  transcriptExcerpt: string,
  researchGrounding: string,
): string {
  const slots = selected
    .map((s, i) => {
      if (s.isWildcard) {
        return `Slot ${i + 1} [WILDCARD]: diverge from the probes above; surface something unexpected and specific to this owner.`;
      }
      const a = s.archetype!;
      return `Slot ${i + 1} [${a.category}] ${a.label}: ${a.seed}`;
    })
    .join("\n");

  return [
    `CLIENT: ${cc.name}`,
    `BUSINESS TYPE: ${cc.businessType}`,
    `MUST-KEEP TOOLS: ${cc.stackMustKeep.join(", ") || "(none stated)"}`,
    `EASY-TO-REPLACE TOOLS: ${cc.stackReplaceEasy.join(", ") || "(none stated)"}`,
    `HARD-TO-REPLACE TOOLS: ${cc.stackReplaceHard.join(", ") || "(none stated)"}`,
    `HYPOTHESES (from the brief):`,
    ...(cc.hypotheses.length ? cc.hypotheses.map((h) => `  - ${h}`) : ["  (none provided)"]),
    "",
    "S2 DISCOVERY TRANSCRIPT EXCERPT:",
    // Feed the full transcript (capped only as a sanity guardrail). The earlier
    // 6000-char first-slice starved the generator: an owner's real idiosyncrasies
    // surface mid-call (well past 6000 chars), so the model was forced to invent
    // grounded-but-off-target scenarios. Confirmed in Phase-5 calibration.
    transcriptExcerpt ? transcriptExcerpt.slice(0, 60000) : "(no transcript provided)",
    ...(researchGrounding ? ["", researchGrounding] : []),
    "",
    `Write exactly ${selected.length} scenario vignettes, one per slot below, in order:`,
    slots,
  ].join("\n");
}

// --- Public action: generate + persist scenarios for a session --------------
export const generateScenarios = action({
  args: {
    clientId: v.id("clients"),
    sessionId: v.id("sessions"),
    transcriptExcerpt: v.optional(v.string()),
    hypotheses: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const base = await ctx.runQuery(internal.scenarioGen.getGenerationContext, {
      clientId: args.clientId,
      sessionId: args.sessionId,
    });
    const cc: ClientContext = {
      name: base.name,
      businessType: base.businessType,
      stackMustKeep: base.stackMustKeep,
      stackReplaceEasy: base.stackReplaceEasy,
      stackReplaceHard: base.stackReplaceHard,
      hypotheses: args.hypotheses ?? [],
    };
    const tier = base.depthTier as "light" | "standard" | "deep";
    const selected = selectArchetypes(cc, tier);

    const result = await anthropicMessage({
      system: buildSystemPrompt(),
      user: buildUserPrompt(cc, selected, args.transcriptExcerpt ?? "", base.researchGrounding ?? ""),
      maxTokens: 4096,
      temperature: 0.8,
    });

    const parsed = extractJson(result.text) as Array<{ slot?: number; title?: string; body?: string }>;
    if (!Array.isArray(parsed)) throw new Error("Model did not return a JSON array");

    // Authoritatively zip model prose back to our deterministic slot plan: we
    // trust the model for title/body only; archetypeKey + isWildcard come from us.
    const plan = DEPTH_PLANS[tier];
    const created: { idx: number; archetypeKey?: string; isWildcard: boolean; title: string }[] = [];
    for (let i = 0; i < selected.length; i++) {
      const slot = selected[i];
      const item =
        parsed.find((p) => p.slot === i + 1) ?? parsed[i] ?? ({} as { title?: string; body?: string });
      const title = (item.title ?? "").trim() || (slot.archetype?.label ?? `Scenario ${i + 1}`);
      const body = (item.body ?? "").trim();
      if (!body) continue; // skip empties rather than persist a blank scenario
      await ctx.runMutation(api.stage3.addScenario, {
        clientId: args.clientId,
        sessionId: args.sessionId,
        idx: i,
        title,
        body,
        isWildcard: slot.isWildcard,
        archetypeKey: slot.archetype?.key,
      });
      created.push({ idx: i, archetypeKey: slot.archetype?.key, isWildcard: slot.isWildcard, title });
    }

    await ctx.runMutation(internal.scenarioGen.markSessionGenerated, {
      clientId: args.clientId,
      sessionId: args.sessionId,
    });

    return {
      requested: selected.length,
      created: created.length,
      wildcards: created.filter((c) => c.isWildcard).length,
      tier,
      planTotal: plan.total,
      model: GEN_MODEL,
      usage: result.usage,
      scenarios: created,
    };
  },
});

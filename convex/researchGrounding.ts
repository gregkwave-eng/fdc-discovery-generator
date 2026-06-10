// ---------------------------------------------------------------------------
// FDC Stage 3 — §5 R3: scoped grounding enablement + grounding preview/diff.
//
// 1. setClientGrounding: the per-client grounding toggle. Greg-only flip
//    (RESEARCH_APPROVER_EMAIL), audited (by/at). Layered UNDER the global master
//    off-switch — flipping a client never affects any other client's generation.
// 2. previewGroundingDiff: for a client with a Gate-1-approved brief, generate
//    scenarios ungrounded vs grounded with the EXACT same prompt (only the
//    grounding block differs) and return them slot-by-slot, so the effect of
//    grounding is visible before/while it goes live. Pure preview — persists
//    nothing, and does NOT depend on the master flag or the client toggle (it's
//    a what-if; the live gate is unchanged).
// ---------------------------------------------------------------------------

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { RESEARCH_APPROVER_EMAIL, buildResearchGroundingBlock } from "./constants";
import { loadApprovedBrief } from "./research";
import { assertSessionInTenant } from "./tenancy";
import {
  type ClientContext,
  DEPTH_PLANS,
  selectArchetypes,
} from "./archetypes";
import { anthropicMessage, extractJson } from "./llm";
import { buildSystemPrompt, buildUserPrompt } from "./scenarioGen";

// --- auth helpers (mirror researchReview) -----------------------------------
async function requireReviewerEmail(ctx: {
  auth: { getUserIdentity: () => Promise<unknown> };
  db: { get: (id: Id<"users">) => Promise<Doc<"users"> | null> };
}): Promise<string> {
  const userId = await getAuthUserId(ctx as never);
  if (!userId) throw new Error("Not authenticated as an FDC reviewer.");
  const user = await ctx.db.get(userId as Id<"users">);
  return String((user as { email?: string } | null)?.email ?? "fdc:unknown");
}

function requireApprover(email: string): void {
  if (email.trim().toLowerCase() !== RESEARCH_APPROVER_EMAIL.toLowerCase()) {
    throw new Error(
      `Grounding enablement is restricted to the Gate-1 approver (${RESEARCH_APPROVER_EMAIL}). You have visibility only.`,
    );
  }
}

// --- core logic (shared by auth mutation + dev harness) ---------------------
export async function _setClientGrounding(
  ctx: any,
  clientId: Id<"clients">,
  enabled: boolean,
  email: string,
) {
  const client = await ctx.db.get(clientId);
  if (!client) throw new Error("Client not found.");
  await ctx.db.patch(clientId, {
    groundingEnabled: enabled,
    groundingEnabledBy: email,
    groundingEnabledAt: Date.now(),
  });
  return { clientId, groundingEnabled: enabled, by: email };
}

// --- Greg-only toggle -------------------------------------------------------
export const setClientGrounding = mutation({
  args: { clientId: v.id("clients"), enabled: v.boolean() },
  handler: async (ctx, { clientId, enabled }) => {
    const email = await requireReviewerEmail(ctx);
    requireApprover(email);
    return await _setClientGrounding(ctx, clientId, enabled, email);
  },
});

// --- preview context loader (internal) --------------------------------------
// Loads the approved brief + tier/transcript for a client. If a sessionId is
// supplied it is tenant-asserted and its depthTier is used; otherwise the caller
// picks a tier. Throws if no approved brief (nothing to preview).
export const getPreviewContext = internalQuery({
  args: {
    clientId: v.id("clients"),
    sessionId: v.optional(v.id("sessions")),
  },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client) throw new Error("Client not found.");
    const brief = await loadApprovedBrief(ctx, args.clientId);
    if (!brief) {
      throw new Error("No Gate-1-approved brief for this client — approve one before previewing.");
    }
    let depthTier: "light" | "standard" | "deep" | null = null;
    if (args.sessionId) {
      await assertSessionInTenant(ctx, args.clientId, args.sessionId);
      const session = await ctx.db.get(args.sessionId);
      depthTier = (session?.depthTier as "light" | "standard" | "deep") ?? null;
    }
    return {
      name: client.name,
      businessType: client.businessType,
      stackMustKeep: client.stackMustKeep,
      stackReplaceEasy: client.stackReplaceEasy,
      stackReplaceHard: client.stackReplaceHard,
      depthTier,
      brief,
    };
  },
});

type PreviewSlot = {
  slot: number;
  label: string;
  isWildcard: boolean;
  ungrounded: { title: string; body: string };
  grounded: { title: string; body: string };
};

// --- preview/diff action ----------------------------------------------------
export const previewGroundingDiff = action({
  args: {
    clientId: v.id("clients"),
    sessionId: v.optional(v.id("sessions")),
    tier: v.optional(v.union(v.literal("light"), v.literal("standard"), v.literal("deep"))),
    transcriptExcerpt: v.optional(v.string()),
    hypotheses: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<{
    clientName: string;
    tier: "light" | "standard" | "deep";
    briefTitle: string;
    findings: Array<{ topic: string; claim: string; kind: "verified" | "inference"; relevance?: string }>;
    groundingBlock: string;
    slots: PreviewSlot[];
    usage: { ungrounded: unknown; grounded: unknown };
  }> => {
    const base = await ctx.runQuery(internal.researchGrounding.getPreviewContext, {
      clientId: args.clientId,
      sessionId: args.sessionId,
    });
    const tier = args.tier ?? base.depthTier ?? "standard";

    const cc: ClientContext = {
      name: base.name,
      businessType: base.businessType,
      stackMustKeep: base.stackMustKeep,
      stackReplaceEasy: base.stackReplaceEasy,
      stackReplaceHard: base.stackReplaceHard,
      hypotheses: args.hypotheses ?? [],
    };
    const selected = selectArchetypes(cc, tier);
    const system = buildSystemPrompt();
    const transcript = args.transcriptExcerpt ?? "";
    const groundingBlock = buildResearchGroundingBlock(base.brief);

    // EXACT same prompt; the ONLY difference is the grounding block. Lower
    // temperature so the observed diff is attributable to grounding, not
    // sampling noise. Run the two variants in parallel.
    const userUngrounded = buildUserPrompt(cc, selected, transcript, "");
    const userGrounded = buildUserPrompt(cc, selected, transcript, groundingBlock);
    const [resU, resG] = await Promise.all([
      anthropicMessage(ctx, { system, user: userUngrounded, maxTokens: 4096, temperature: 0.3 }),
      anthropicMessage(ctx, { system, user: userGrounded, maxTokens: 4096, temperature: 0.3 }),
    ]);

    const parse = (text: string) => {
      const arr = extractJson(text) as Array<{ slot?: number; title?: string; body?: string }>;
      return Array.isArray(arr) ? arr : [];
    };
    const pu = parse(resU.text);
    const pg = parse(resG.text);
    const pick = (arr: ReturnType<typeof parse>, i: number) =>
      arr.find((p) => p.slot === i + 1) ?? arr[i] ?? {};

    const slots: PreviewSlot[] = selected.map((s, i) => {
      const u = pick(pu, i);
      const gp = pick(pg, i);
      return {
        slot: i + 1,
        label: s.isWildcard ? "Wildcard" : (s.archetype?.label ?? `Slot ${i + 1}`),
        isWildcard: s.isWildcard,
        ungrounded: { title: (u.title ?? "").trim(), body: (u.body ?? "").trim() },
        grounded: { title: (gp.title ?? "").trim(), body: (gp.body ?? "").trim() },
      };
    });

    return {
      clientName: base.name,
      tier,
      briefTitle: base.brief.title,
      findings: base.brief.findings,
      groundingBlock,
      slots,
      usage: { ungrounded: resU.usage, grounded: resG.usage },
    };
  },
});

// Convenience query so the panel can show the plan size before running.
export const previewPlanSize = query({
  args: { tier: v.union(v.literal("light"), v.literal("standard"), v.literal("deep")) },
  handler: async (_ctx, { tier }) => DEPTH_PLANS[tier].total,
});

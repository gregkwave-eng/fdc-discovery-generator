// ---------------------------------------------------------------------------
// FDC Stage 3 — Research brief import + grounding loader (§5 R-phase, R0)
//
// Entry point: `importResearchBrief` takes a producer id + native payload,
// dispatches to that producer's pure `normalize`, and persists the result as a
// PENDING brief (status "pending") awaiting Gate-1 human vetting. Nothing
// imported here can influence scenario generation until a reviewer approves it
// (researchReview.ts) AND the RESEARCH_GROUNDING_ENABLED master flag is on.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { mutation, internalQuery, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getProducer } from "./researchProducers";
import { RESEARCH_SCOPE, RESEARCH_GROUNDING_ENABLED, buildResearchGroundingBlock } from "./constants";

// --- import (manual / pure-producer path) -----------------------------------
export const importResearchBrief = mutation({
  args: {
    clientId: v.id("clients"),
    producer: v.string(),
    raw: v.string(), // producer-native payload (manual = JSON string)
    importedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client) throw new Error("client not found");

    const producer = getProducer(args.producer); // throws on unknown producer
    const nb = producer.normalize(args.raw); // pure, may throw ResearchProducerError

    const briefId = await ctx.db.insert("researchBriefs", {
      clientId: args.clientId,
      producer: producer.id,
      title: nb.title,
      summary: nb.summary,
      findings: nb.findings,
      ownerResearchIncluded: nb.ownerResearchIncluded,
      scope: RESEARCH_SCOPE,
      rawImport: args.raw.slice(0, 100000), // provenance (bounded)
      status: "pending",
      importedBy: args.importedBy ?? "system",
      importedAt: Date.now(),
    });
    return {
      briefId,
      producer: producer.id,
      findingCount: nb.findings.length,
      verifiedCount: nb.findings.filter((f) => f.kind === "verified").length,
      inferenceCount: nb.findings.filter((f) => f.kind === "inference").length,
      status: "pending" as const,
    };
  },
});

// --- active clients (for the /review Import control, R2) ---------------------
export const listClients = query({
  args: {},
  handler: async (ctx) => {
    const clients = await ctx.db
      .query("clients")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    return clients
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({ clientId: c._id, name: c.name, businessType: c.businessType }));
  },
});

// --- visibility: list a client's briefs (any status) ------------------------
export const listClientBriefs = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const briefs = await ctx.db
      .query("researchBriefs")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();
    return briefs
      .sort((a, b) => b.importedAt - a.importedAt)
      .map((b) => ({
        briefId: b._id,
        producer: b.producer,
        title: b.title,
        status: b.status,
        findingCount: b.findings.length,
        verifiedCount: b.findings.filter((f) => f.kind === "verified").length,
        ownerResearchIncluded: b.ownerResearchIncluded,
        importedAt: b.importedAt,
        reviewedBy: b.reviewedBy ?? null,
        reviewedAt: b.reviewedAt ?? null,
      }));
  },
});

// --- grounding loader (used by scenarioGen when the flag is on) -------------
// Returns the single currently-APPROVED brief for a client (latest by review
// time), or null. Approval supersedes prior approved briefs, so at most one is
// ever "approved" — but we sort defensively.
export async function loadApprovedBrief(
  ctx: { db: any },
  clientId: Id<"clients">,
): Promise<null | {
  briefId: Id<"researchBriefs">;
  title: string;
  summary: string;
  findings: Array<{ topic: string; claim: string; kind: "verified" | "inference"; relevance?: string }>;
}> {
  const approved = await ctx.db
    .query("researchBriefs")
    .withIndex("by_client_status", (q: any) => q.eq("clientId", clientId).eq("status", "approved"))
    .collect();
  if (approved.length === 0) return null;
  approved.sort((a: any, b: any) => (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0));
  const b = approved[0];
  return {
    briefId: b._id,
    title: b.title,
    summary: b.summary,
    findings: b.findings.map((f: any) => ({
      topic: f.topic,
      claim: f.claim,
      kind: f.kind,
      relevance: f.relevance,
    })),
  };
}

// Internal query: the grounding BLOCK string for a client (or "" if none /
// flag-gated upstream). Kept here so the prompt format lives next to the data.
export const getGroundingBlock = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args): Promise<string> => {
    const brief = await loadApprovedBrief(ctx, args.clientId);
    if (!brief) return "";
    return buildResearchGroundingBlock(brief);
  },
});

// --- §5 R3: scoped grounding decision ---------------------------------------
export type GroundingReason =
  | "master_off"
  | "client_off"
  | "no_approved_brief"
  | "grounded";

// PURE decision function — the whole 3-layer gate in one place, exhaustively
// testable with no DB/LLM/constant dependency. Fail-closed: every layer must be
// true. `master` = RESEARCH_GROUNDING_ENABLED, `clientEnabled` = the per-client
// toggle, `hasApprovedBrief` = a Gate-1-approved brief exists for the client.
export function groundingDecision(
  master: boolean,
  clientEnabled: boolean,
  hasApprovedBrief: boolean,
): { enabled: boolean; reason: GroundingReason } {
  if (!master) return { enabled: false, reason: "master_off" };
  if (!clientEnabled) return { enabled: false, reason: "client_off" };
  if (!hasApprovedBrief) return { enabled: false, reason: "no_approved_brief" };
  return { enabled: true, reason: "grounded" };
}

// Resolver: feeds live values into the pure decision. Session-aware signature so
// a per-session override can layer in later without a refactor (R3 ships
// per-client only). Returns the decision + the approved brief (if any) so a
// single call drives both gating and the grounding block.
export async function resolveGrounding(
  ctx: { db: any },
  clientId: Id<"clients">,
  _sessionId?: Id<"sessions">,
): Promise<{
  enabled: boolean;
  reason: GroundingReason;
  master: boolean;
  clientEnabled: boolean;
  hasApprovedBrief: boolean;
  brief: Awaited<ReturnType<typeof loadApprovedBrief>>;
}> {
  const client = await ctx.db.get(clientId);
  const clientEnabled = client?.groundingEnabled === true;
  const brief = await loadApprovedBrief(ctx, clientId);
  const hasApprovedBrief = brief !== null;
  const master = RESEARCH_GROUNDING_ENABLED;
  const d = groundingDecision(master, clientEnabled, hasApprovedBrief);
  return { ...d, master, clientEnabled, hasApprovedBrief, brief };
}

// Query: grounding status for a client — for the /review Grounding panel.
export const getClientGroundingState = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client) throw new Error("Client not found.");
    const g = await resolveGrounding(ctx, args.clientId);
    return {
      clientId: args.clientId,
      clientName: client.name,
      master: g.master,
      clientEnabled: g.clientEnabled,
      hasApprovedBrief: g.hasApprovedBrief,
      effective: g.enabled,
      reason: g.reason,
      approvedBriefTitle: g.brief?.title ?? null,
      groundingEnabledBy: client.groundingEnabledBy ?? null,
      groundingEnabledAt: client.groundingEnabledAt ?? null,
    };
  },
});

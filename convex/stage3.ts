import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { assertSessionInTenant, scopedBySession } from "./tenancy";
import { computeRollup } from "./rollup";

// ---------------------------------------------------------------------------
// Phase 1 tenant-scoped data access. NOTE: auth (HMAC magic-link / Convex Auth)
// lands in Phase 3 — until then the (clientId, sessionId) tenant context is
// passed explicitly and validated by the tenancy guards. The guards are the
// part that survives into Phase 3; auth just *derives* the context instead of
// trusting the caller to supply it.
// ---------------------------------------------------------------------------

// --- Clients (tenant root) -------------------------------------------------
export const createClient = mutation({
  args: {
    name: v.string(),
    businessType: v.string(),
    stackMustKeep: v.optional(v.array(v.string())),
    stackReplaceEasy: v.optional(v.array(v.string())),
    stackReplaceHard: v.optional(v.array(v.string())),
    securityTier: v.optional(v.union(v.literal("medium"), v.literal("hipaa"))),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("clients", {
      name: args.name,
      businessType: args.businessType,
      stackMustKeep: args.stackMustKeep ?? [],
      stackReplaceEasy: args.stackReplaceEasy ?? [],
      stackReplaceHard: args.stackReplaceHard ?? [],
      securityTier: args.securityTier ?? "medium",
      status: "active",
      createdAt: Date.now(),
    });
  },
});

// --- Sessions --------------------------------------------------------------
export const createSession = mutation({
  args: {
    clientId: v.id("clients"),
    depthTier: v.union(v.literal("light"), v.literal("standard"), v.literal("deep")),
  },
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client) throw new Error("client not found");
    return await ctx.db.insert("sessions", {
      clientId: args.clientId,
      depthTier: args.depthTier,
      status: "draft",
      createdAt: Date.now(),
    });
  },
});

/** Tenant-scoped: list sessions for a client. */
export const listSessions = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sessions")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();
  },
});

// --- Scenarios -------------------------------------------------------------
export const addScenario = mutation({
  args: {
    clientId: v.id("clients"),
    sessionId: v.id("sessions"),
    idx: v.number(),
    title: v.string(),
    body: v.string(),
    isWildcard: v.optional(v.boolean()),
    archetypeKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // GUARD: session must belong to clientId
    await assertSessionInTenant(ctx, args.clientId, args.sessionId);
    return await ctx.db.insert("scenarios", {
      clientId: args.clientId,
      sessionId: args.sessionId,
      idx: args.idx,
      title: args.title,
      body: args.body,
      isWildcard: args.isWildcard ?? false,
      archetypeKey: args.archetypeKey,
      status: "pending",
    });
  },
});

/** GUARDED: returns this session's scenarios only — 0 rows on cross-tenant. */
export const listScenarios = query({
  args: { clientId: v.id("clients"), sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await scopedBySession(ctx, "scenarios", args.clientId, args.sessionId);
  },
});

// --- Idiosyncrasy ledger ---------------------------------------------------
export const addLedgerEntry = mutation({
  args: {
    clientId: v.id("clients"),
    sessionId: v.id("sessions"),
    scenarioId: v.id("scenarios"),
    summary: v.string(),
    category: v.union(
      v.literal("process-exception"),
      v.literal("tool-attachment"),
      v.literal("terminology"),
      v.literal("compliance/edge-case"),
      v.literal("customer-handling"),
      v.literal("pricing/commercial"),
      v.literal("data-shape"),
      v.literal("trust/control"),
    ),
    evidenceExcerpt: v.string(),
    severity: v.union(v.literal("high"), v.literal("med"), v.literal("low")),
    confidence: v.union(v.literal("high"), v.literal("med"), v.literal("low")),
    buildImplication: v.string(),
    s4Treatment: v.union(
      v.literal("affirm"),
      v.literal("adjust-design"),
      v.literal("flag-risk"),
      v.literal("spotlight"),
    ),
    linkedStackItem: v.optional(v.string()),
    linkedHypothesis: v.optional(
      v.union(v.literal("confirms"), v.literal("contradicts"), v.literal("new")),
    ),
  },
  handler: async (ctx, args) => {
    // GUARD: session must belong to clientId, scenario must be in scope
    await assertSessionInTenant(ctx, args.clientId, args.sessionId);
    const scenario = await ctx.db.get(args.scenarioId);
    if (!scenario || scenario.sessionId !== args.sessionId || scenario.clientId !== args.clientId) {
      throw new Error("scenario not in scope");
    }
    return await ctx.db.insert("idiosyncrasyLedger", {
      clientId: args.clientId,
      sessionId: args.sessionId,
      scenarioId: args.scenarioId,
      summary: args.summary,
      category: args.category,
      evidenceExcerpt: args.evidenceExcerpt,
      severity: args.severity,
      confidence: args.confidence,
      buildImplication: args.buildImplication,
      s4Treatment: args.s4Treatment,
      linkedStackItem: args.linkedStackItem,
      linkedHypothesis: args.linkedHypothesis,
      status: "open",
      createdAt: Date.now(),
    });
  },
});

/** GUARDED: the single S3->S4 read path — this session's ledger only. */
export const getLedger = query({
  args: { clientId: v.id("clients"), sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    return await scopedBySession(ctx, "idiosyncrasyLedger", args.clientId, args.sessionId);
  },
});

/**
 * GUARDED: session rollup (S3->S4 contract summary) — top idiosyncrasies by
 * severity, hypotheses confirmed vs contradicted, and which must-keep tools the
 * owner reacted hardest to. Computed from this session's ledger only.
 */
export const getSessionRollup = query({
  args: { clientId: v.id("clients"), sessionId: v.id("sessions") },
  handler: async (ctx, args) => {
    const entries = (await scopedBySession(
      ctx, "idiosyncrasyLedger", args.clientId, args.sessionId,
    )) as unknown as Doc<"idiosyncrasyLedger">[];
    const client = await ctx.db.get(args.clientId);
    return computeRollup(args.sessionId, entries, new Set(client?.stackMustKeep ?? []));
  },
});

// ---------------------------------------------------------------------------
// /review approver surface (Decision #7, Gate 1).
//
// The ONLY humans here are FDC reviewers, authenticated via Convex Auth (domain
// allow-list @frankdataconsultants.com, enforced in auth.ts). Every function
// re-checks `getAuthUserId` and reads the reviewer's email for the audit trail.
// Owners never touch these (they use stateless magic links).
//
// Gate 1 = a reviewer must explicitly APPROVE a `generated` session before the
// owner link can ever be issued. Approve / reject / edit / regenerate are all
// audited (sessionAudit) so the gate is provable after the fact.
// ---------------------------------------------------------------------------

import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { recordTransition } from "./transitions";

// --- auth helpers -----------------------------------------------------------

async function requireReviewerEmail(ctx: {
  auth: { getUserIdentity: () => Promise<unknown> };
  db: { get: (id: Id<"users">) => Promise<Doc<"users"> | null> };
}): Promise<string> {
  // getAuthUserId works in query/mutation/action ctx.
  const userId = await getAuthUserId(ctx as never);
  if (!userId) throw new Error("Not authenticated as an FDC reviewer.");
  const user = await ctx.db.get(userId as Id<"users">);
  const email = (user as { email?: string } | null)?.email;
  return String(email ?? "fdc:unknown");
}

async function auditEvent(
  ctx: { db: { get: (id: Id<"sessions">) => Promise<Doc<"sessions"> | null>; insert: (t: "sessionAudit", d: Record<string, unknown>) => Promise<unknown> } },
  sessionId: Id<"sessions">,
  action: string,
  actor: string,
  note?: string,
) {
  const s = await ctx.db.get(sessionId);
  if (!s) throw new Error("Session not found.");
  await ctx.db.insert("sessionAudit", {
    clientId: s.clientId,
    sessionId,
    fromStatus: s.status,
    toStatus: s.status,
    action,
    actor,
    note,
    at: Date.now(),
  });
}

// --- queries ----------------------------------------------------------------

export type ReviewQueueItem = {
  sessionId: Id<"sessions">;
  clientName: string;
  businessType: string;
  depthTier: string;
  scenarioCount: number;
  status: string;
  createdAt: number;
};

export const listReviewQueue = query({
  args: {},
  handler: async (ctx): Promise<ReviewQueueItem[]> => {
    await requireReviewerEmail(ctx);
    // Everything that needs a reviewer's eyes: awaiting approval (generated),
    // approved-but-not-yet-invited (fdc_approved), and anything escalated.
    const statuses = ["generated", "fdc_approved", "escalated"] as const;
    const out: ReviewQueueItem[] = [];
    for (const st of statuses) {
      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_status", (q) => q.eq("status", st))
        .collect();
      for (const s of sessions) {
        const client = await ctx.db.get(s.clientId);
        const scenarios = await ctx.db
          .query("scenarios")
          .withIndex("by_session", (q) => q.eq("sessionId", s._id))
          .collect();
        out.push({
          sessionId: s._id,
          clientName: client?.name ?? "(unknown)",
          businessType: client?.businessType ?? "",
          depthTier: s.depthTier,
          scenarioCount: scenarios.length,
          status: s.status,
          createdAt: s.createdAt,
        });
      }
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const getReviewSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    await requireReviewerEmail(ctx);
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session not found.");
    const client = await ctx.db.get(session.clientId);
    const scenarios = (
      await ctx.db
        .query("scenarios")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .collect()
    ).sort((a, b) => a.idx - b.idx);
    const audit = (
      await ctx.db
        .query("sessionAudit")
        .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
        .collect()
    ).sort((a, b) => a.at - b.at);
    return {
      session: {
        sessionId: session._id,
        status: session.status,
        depthTier: session.depthTier,
        fdcApprovedBy: session.fdcApprovedBy ?? null,
        fdcApprovedAt: session.fdcApprovedAt ?? null,
        invitedAt: session.invitedAt ?? null,
        substantiveFraction: session.substantiveFraction ?? 0,
        createdAt: session.createdAt,
      },
      client: client ? { name: client.name, businessType: client.businessType } : null,
      scenarios: scenarios.map((s) => ({
        scenarioId: s._id,
        idx: s.idx,
        title: s.title,
        body: s.body,
        isWildcard: s.isWildcard,
      })),
      audit: audit.map((a) => ({
        fromStatus: a.fromStatus,
        toStatus: a.toStatus,
        action: a.action,
        actor: a.actor,
        note: a.note ?? null,
        at: a.at,
      })),
    };
  },
});

// --- core logic (shared by auth mutations + dev harness) --------------------

export async function _approve(ctx: any, sessionId: Id<"sessions">, email: string) {
  const r = await recordTransition(ctx, {
    sessionId,
    to: "fdc_approved",
    action: "fdc_approve",
    actor: `fdc:${email}`,
    patch: { fdcApprovedBy: email, fdcApprovedAt: Date.now() },
  });
  return { status: "fdc_approved", from: r.from };
}

export async function _reject(ctx: any, sessionId: Id<"sessions">, email: string, note: string) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error("Session not found.");
  if (session.status === "fdc_approved") {
    // un-approve: send back to generated for regen/edit
    await recordTransition(ctx, {
      sessionId,
      to: "generated",
      action: "fdc_reject",
      actor: `fdc:${email}`,
      note,
      patch: { fdcApprovedBy: undefined, fdcApprovedAt: undefined },
    });
  } else {
    // already generated — record the reject reason, stays in queue for regen
    await auditEvent(ctx, sessionId, "fdc_reject", `fdc:${email}`, note);
  }
  return { status: "generated" };
}

export async function _editScenario(
  ctx: any,
  sessionId: Id<"sessions">,
  scenarioId: Id<"scenarios">,
  title: string,
  body: string,
  email: string,
) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error("Session not found.");
  if (session.status !== "generated" && session.status !== "fdc_approved") {
    throw new Error("Scenarios can only be edited before the owner begins.");
  }
  const scenario = await ctx.db.get(scenarioId);
  if (!scenario || scenario.sessionId !== sessionId) throw new Error("Scenario not in session.");
  await ctx.db.patch(scenarioId, { title, body });
  await auditEvent(ctx, sessionId, "scenario_edit", `fdc:${email}`, `edited #${scenario.idx}: ${title}`);
  return { ok: true };
}

export async function _clearScenarios(ctx: any, sessionId: Id<"sessions">, email: string) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error("Session not found.");
  if (session.status !== "generated" && session.status !== "fdc_approved") {
    throw new Error("Can only regenerate before the owner begins.");
  }
  const scenarios = await ctx.db
    .query("scenarios")
    .withIndex("by_session", (q: any) => q.eq("sessionId", sessionId))
    .collect();
  for (const s of scenarios) await ctx.db.delete(s._id);
  await auditEvent(ctx, sessionId, "regenerate", `fdc:${email}`, `cleared ${scenarios.length} scenarios for regen`);
  return { clientId: session.clientId };
}

// --- auth-gated mutations (the real reviewer entry points) ------------------

export const fdcApprove = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const email = await requireReviewerEmail(ctx);
    return await _approve(ctx, sessionId, email);
  },
});

export const fdcReject = mutation({
  args: { sessionId: v.id("sessions"), note: v.string() },
  handler: async (ctx, { sessionId, note }) => {
    const email = await requireReviewerEmail(ctx);
    return await _reject(ctx, sessionId, email, note);
  },
});

export const fdcEditScenario = mutation({
  args: { sessionId: v.id("sessions"), scenarioId: v.id("scenarios"), title: v.string(), body: v.string() },
  handler: async (ctx, { sessionId, scenarioId, title, body }) => {
    const email = await requireReviewerEmail(ctx);
    return await _editScenario(ctx, sessionId, scenarioId, title, body, email);
  },
});

// Regenerate = clear existing scenarios then re-run the Phase-2 generator.
// Auth-checked in the action (getAuthUserId reads the reviewer JWT); the clear
// runs via an internal mutation (auth identity does NOT propagate to internal
// fns, so we pass the email through explicitly).
export const _clearScenariosInternal = internalMutation({
  args: { sessionId: v.id("sessions"), email: v.string() },
  handler: async (ctx, { sessionId, email }) => {
    return await _clearScenarios(ctx, sessionId, email);
  },
});

export const fdcRegenerate = action({
  args: {
    sessionId: v.id("sessions"),
    transcriptExcerpt: v.optional(v.string()),
    hypotheses: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { sessionId, transcriptExcerpt, hypotheses }): Promise<{ ok: boolean }> => {
    const userId = await getAuthUserId(ctx as never);
    if (!userId) throw new Error("Not authenticated as an FDC reviewer.");
    const email = await ctx.runQuery(internal.review._emailForUser, { userId: userId as Id<"users"> });
    const { clientId } = await ctx.runMutation(internal.review._clearScenariosInternal, { sessionId, email });
    await ctx.runAction(api.scenarioGen.generateScenarios, {
      clientId,
      sessionId,
      transcriptExcerpt,
      hypotheses,
    });
    return { ok: true };
  },
});

export const _emailForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return String((user as { email?: string } | null)?.email ?? "fdc:unknown");
  },
});

// --- owner invite (Decision #5: a SECOND explicit click) --------------------
// FDC approval (Gate 1) does NOT auto-send the owner link. Inviting the owner is
// a distinct, deliberate action a reviewer takes after approval. Decision #6:
// owner emails are HELD behind this OFF flag — inviteOwner issues the magic
// link and returns it for manual sending; it never emails until Greg flips this.
const OWNER_EMAIL_ENABLED = false;

export async function _invite(ctx: any, sessionId: Id<"sessions">, email: string) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error("Session not found.");
  if (session.status !== "fdc_approved") {
    throw new Error("Owner can only be invited after Gate 1 approval (fdc_approved).");
  }
  await ctx.db.patch(sessionId, { invitedAt: Date.now() });
  await auditEvent(ctx, sessionId, "owner_invite", `fdc:${email}`, "owner link issued (email held OFF)");
  return { clientId: session.clientId };
}

export const _markInvited = internalMutation({
  args: { sessionId: v.id("sessions"), email: v.string() },
  handler: async (ctx, { sessionId, email }) => {
    return await _invite(ctx, sessionId, email);
  },
});

export const _sessionStatus = internalQuery({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const s = await ctx.db.get(sessionId);
    return s ? { status: s.status } : null;
  },
});

export const inviteOwner = action({
  args: { sessionId: v.id("sessions") },
  handler: async (
    ctx,
    { sessionId },
  ): Promise<{ path: string; token: string; expiresAt: number; emailed: boolean }> => {
    const userId = await getAuthUserId(ctx as never);
    if (!userId) throw new Error("Not authenticated as an FDC reviewer.");
    const email = await ctx.runQuery(internal.review._emailForUser, { userId: userId as Id<"users"> });
    const scope = await ctx.runQuery(internal.review._sessionStatus, { sessionId });
    if (!scope) throw new Error("Session not found.");
    if (scope.status !== "fdc_approved") {
      throw new Error("Owner can only be invited after Gate 1 approval (fdc_approved).");
    }
    // Issue the magic link, then record the invite (gate re-checked in the mutation).
    const link = await ctx.runAction(api.magiclink.issueMagicLink, { sessionId });
    await ctx.runMutation(internal.review._markInvited, { sessionId, email });
    // Email is HELD behind the OFF flag — return the link for manual sending.
    if (OWNER_EMAIL_ENABLED) {
      // (future) send via Resend here once Greg flips owner-email on.
    }
    return { path: link.path, token: link.token, expiresAt: link.expiresAt, emailed: false };
  },
});

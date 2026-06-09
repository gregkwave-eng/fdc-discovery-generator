import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { _invite } from "./review";

declare const process: { env: Record<string, string | undefined> };

function devOnly() {
  if (process.env.VIKTOR_SPACES_IS_PREVIEW !== "true") {
    throw new Error("dev-only fixture, disabled on production.");
  }
}

// ---------------------------------------------------------------------------
// Sub-step (c) verification.
// runInviteAudit: self-cleaning unit test of the invite gate (Decision #5).
// _devSeedApproved / _devCleanupClient: support an over-the-wire Gate-2 e2e
// (preview -> Begin -> respond) run from the test script without a paid
// generation call. DEV-only — remove before prod.
// ---------------------------------------------------------------------------

export const runInviteAudit = mutation({
  args: {},
  handler: async (ctx) => {
    devOnly();
    const report: { check: string; pass: boolean; detail: string }[] = [];
    const now = Date.now();
    const clientId = await ctx.db.insert("clients", {
      name: "GATE2_invite_test", businessType: "marine", stackMustKeep: [], stackReplaceEasy: [],
      stackReplaceHard: [], securityTier: "medium", status: "active", createdAt: now,
    });
    // approved session — invite should succeed
    const approved = await ctx.db.insert("sessions", {
      clientId, depthTier: "standard", status: "fdc_approved",
      fdcApprovedBy: "greg@frankdataconsultants.com", fdcApprovedAt: now, createdAt: now,
    });
    await _invite(ctx, approved, "graham@frankdataconsultants.com");
    const s = await ctx.db.get(approved);
    const audit = await ctx.db
      .query("sessionAudit").withIndex("by_session", (q) => q.eq("sessionId", approved)).collect();
    report.push({
      check: "invite on fdc_approved: invitedAt set + owner_invite audited",
      pass: !!s?.invitedAt && audit.length === 1 && audit[0].action === "owner_invite",
      detail: `invitedAt=${!!s?.invitedAt} audit=[${audit.map((a) => a.action).join(",")}]`,
    });

    // generated session — invite must be rejected (gate not cleared)
    const gen = await ctx.db.insert("sessions", {
      clientId, depthTier: "light", status: "generated", createdAt: now,
    });
    let threw = false;
    try {
      await _invite(ctx, gen, "greg@frankdataconsultants.com");
    } catch {
      threw = true;
    }
    report.push({
      check: "invite on generated (pre-approval) rejected",
      pass: threw,
      detail: threw ? "rejected" : "NOT rejected (breach)",
    });

    // cleanup
    for (const a of audit) await ctx.db.delete(a._id);
    await ctx.db.delete(approved);
    await ctx.db.delete(gen);
    await ctx.db.delete(clientId);
    return {
      allPass: report.every((r) => r.pass),
      total: report.length,
      passed: report.filter((r) => r.pass).length,
      report,
    };
  },
});

export const _devSeedApproved = mutation({
  args: {},
  handler: async (ctx) => {
    devOnly();
    const now = Date.now();
    const clientId = await ctx.db.insert("clients", {
      name: "GATE2_E2E_seed", businessType: "marine services", stackMustKeep: [], stackReplaceEasy: [],
      stackReplaceHard: [], securityTier: "medium", status: "active", createdAt: now,
    });
    const sessionId = await ctx.db.insert("sessions", {
      clientId, depthTier: "light", status: "fdc_approved",
      fdcApprovedBy: "greg@frankdataconsultants.com", fdcApprovedAt: now, createdAt: now,
    });
    const scenarioId = await ctx.db.insert("scenarios", {
      clientId, sessionId, idx: 0, isWildcard: false,
      title: "Haul-out call", body: "A regular asks for a last-minute haul-out. Walk me through how you decide.",
      status: "pending",
    });
    return { clientId, sessionId, scenarioId };
  },
});

export const _devCleanupClient = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    devOnly();
    const sessions = await ctx.db
      .query("sessions").filter((q) => q.eq(q.field("clientId"), clientId)).collect();
    for (const s of sessions) {
      for (const t of ["scenarios", "responses", "sessionAudit"] as const) {
        const rows = await ctx.db
          .query(t).withIndex("by_session", (q: any) => q.eq("sessionId", s._id)).collect();
        for (const r of rows) await ctx.db.delete(r._id);
      }
      await ctx.db.delete(s._id);
    }
    await ctx.db.delete(clientId);
    return { deletedSessions: sessions.length };
  },
});

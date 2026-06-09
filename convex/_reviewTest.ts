import { mutation } from "./_generated/server";
import { _approve, _reject, _editScenario } from "./review";

declare const process: { env: Record<string, string | undefined> };

// ---------------------------------------------------------------------------
// Sub-step (b) verification: /review approver logic (Gate 1).
// Exercises the shared approve/reject/edit helpers with a stand-in reviewer
// email (the real mutations add the Convex-Auth gate, verified separately by an
// unauthenticated-rejection probe). Self-cleaning. DEV-only — remove before prod.
// ---------------------------------------------------------------------------

export const runReviewAudit = mutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.VIKTOR_SPACES_IS_PREVIEW !== "true") {
      throw new Error("runReviewAudit is a dev-only fixture and is disabled on production.");
    }
    const report: { check: string; pass: boolean; detail: string }[] = [];
    const now = Date.now();

    const clientId = await ctx.db.insert("clients", {
      name: "REVIEW_TEST_client", businessType: "marine", stackMustKeep: [], stackReplaceEasy: [],
      stackReplaceHard: [], securityTier: "medium", status: "active", createdAt: now,
    });
    const sessionId = await ctx.db.insert("sessions", {
      clientId, depthTier: "standard", status: "generated", createdAt: now,
    });
    const sc1 = await ctx.db.insert("scenarios", {
      clientId, sessionId, idx: 0, isWildcard: false, title: "Old title", body: "Old body", status: "pending",
    });
    await ctx.db.insert("scenarios", {
      clientId, sessionId, idx: 1, isWildcard: true, title: "WC", body: "WC body", status: "pending",
    });

    // approve
    await _approve(ctx, sessionId, "greg@frankdataconsultants.com");
    let s = await ctx.db.get(sessionId);
    report.push({
      check: "approve: generated->fdc_approved + approver recorded",
      pass: s?.status === "fdc_approved" && s?.fdcApprovedBy === "greg@frankdataconsultants.com" && !!s?.fdcApprovedAt,
      detail: `status=${s?.status} approver=${s?.fdcApprovedBy}`,
    });

    // reject (un-approve back to generated, clears approver)
    await _reject(ctx, sessionId, "graham@frankdataconsultants.com", "sharpen the wildcard");
    s = await ctx.db.get(sessionId);
    report.push({
      check: "reject: fdc_approved->generated + approver cleared",
      pass: s?.status === "generated" && !s?.fdcApprovedBy,
      detail: `status=${s?.status} approver=${s?.fdcApprovedBy ?? "(cleared)"}`,
    });

    // edit a scenario (allowed while generated)
    await _editScenario(ctx, sessionId, sc1, "New title", "New body text here", "graham@frankdataconsultants.com");
    const editted = await ctx.db.get(sc1);
    report.push({
      check: "edit scenario: title/body updated + audited",
      pass: editted?.title === "New title" && editted?.body === "New body text here",
      detail: `title=${editted?.title}`,
    });

    // re-approve
    await _approve(ctx, sessionId, "greg@frankdataconsultants.com");
    s = await ctx.db.get(sessionId);
    report.push({
      check: "re-approve after edit",
      pass: s?.status === "fdc_approved",
      detail: `status=${s?.status}`,
    });

    // audit trail accumulated (approve, reject, edit, approve = 4)
    const audit = await ctx.db
      .query("sessionAudit")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    const actions = audit.map((a) => a.action).join(",");
    report.push({
      check: "audit trail: approve,reject,scenario_edit,approve",
      pass: audit.length === 4 && actions === "fdc_approve,fdc_reject,scenario_edit,fdc_approve",
      detail: `[${actions}]`,
    });

    // negative: approving a fresh draft session is illegal (gate can't be skipped)
    const draftSession = await ctx.db.insert("sessions", {
      clientId, depthTier: "light", status: "draft", createdAt: now,
    });
    let threw = false;
    try {
      await _approve(ctx, draftSession, "greg@frankdataconsultants.com");
    } catch {
      threw = true;
    }
    report.push({
      check: "approve a draft (un-generated) session rejected",
      pass: threw,
      detail: threw ? "rejected" : "NOT rejected (breach)",
    });

    // cleanup
    for (const a of audit) await ctx.db.delete(a._id);
    const draftAudit = await ctx.db
      .query("sessionAudit")
      .withIndex("by_session", (q) => q.eq("sessionId", draftSession))
      .collect();
    for (const a of draftAudit) await ctx.db.delete(a._id);
    const scs = await ctx.db
      .query("scenarios")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const sc of scs) await ctx.db.delete(sc._id);
    await ctx.db.delete(draftSession);
    await ctx.db.delete(sessionId);
    await ctx.db.delete(clientId);

    return {
      allPass: report.every((r) => r.pass),
      total: report.length,
      passed: report.filter((r) => r.pass).length,
      report,
    };
  },
});

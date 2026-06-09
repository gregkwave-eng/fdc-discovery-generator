import { mutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { assertSessionInTenant, scopedBySession, TenancyError } from "./tenancy";
import { computeRollup } from "./rollup";

declare const process: { env: Record<string, string | undefined> };

// ---------------------------------------------------------------------------
// Phase 1 verification: tenant + session isolation / IDOR.
// One self-cleaning mutation: seed two tenants, probe cross-tenant access,
// assert isolation, delete the seeded rows, return a structured report.
// Invoke ONCE over HTTPS (ConvexHttpClient) — see scripts/phase1_idor_test.
// This is a DEV-only verification fixture; remove before production promote.
// ---------------------------------------------------------------------------

async function expectThrow(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false; // did NOT throw = isolation breach
  } catch (e) {
    return e instanceof TenancyError;
  }
}

export const runIdorAudit = mutation({
  args: {},
  handler: async (ctx) => {
    // Hard prod guard: this dev-only fixture refuses to run on a production
    // deployment (preview/dev sets VIKTOR_SPACES_IS_PREVIEW="true"). Belt-and-
    // suspenders even though it's slated for removal before go-live.
    if (process.env.VIKTOR_SPACES_IS_PREVIEW !== "true") {
      throw new Error("runIdorAudit is a dev-only fixture and is disabled on production.");
    }
    const report: { check: string; pass: boolean; detail: string }[] = [];
    const now = Date.now();

    // --- seed two isolated tenants ---
    const clientA = await ctx.db.insert("clients", {
      name: "TENANT_A_test", businessType: "marine", stackMustKeep: ["SeakeeperWarranty"],
      stackReplaceEasy: [], stackReplaceHard: [], securityTier: "medium",
      status: "active", createdAt: now,
    });
    const clientB = await ctx.db.insert("clients", {
      name: "TENANT_B_test", businessType: "events", stackMustKeep: [], stackReplaceEasy: [],
      stackReplaceHard: [], securityTier: "medium", status: "active", createdAt: now,
    });
    const sessionA = await ctx.db.insert("sessions", {
      clientId: clientA, depthTier: "standard", status: "draft", createdAt: now,
    });
    const sessionB = await ctx.db.insert("sessions", {
      clientId: clientB, depthTier: "standard", status: "draft", createdAt: now,
    });
    const scenarioA = await ctx.db.insert("scenarios", {
      clientId: clientA, sessionId: sessionA, idx: 0, isWildcard: false,
      title: "A-scn", body: "x", status: "pending",
    });
    const scenarioB = await ctx.db.insert("scenarios", {
      clientId: clientB, sessionId: sessionB, idx: 0, isWildcard: false,
      title: "B-scn", body: "x", status: "pending",
    });
    await ctx.db.insert("idiosyncrasyLedger", {
      clientId: clientA, sessionId: sessionA, scenarioId: scenarioA, summary: "A-secret",
      category: "tool-attachment", evidenceExcerpt: "A", severity: "high", confidence: "high",
      buildImplication: "A", s4Treatment: "spotlight", status: "open", createdAt: now,
      linkedStackItem: "SeakeeperWarranty", linkedHypothesis: "contradicts",
    });
    await ctx.db.insert("idiosyncrasyLedger", {
      clientId: clientB, sessionId: sessionB, scenarioId: scenarioB, summary: "B-secret",
      category: "terminology", evidenceExcerpt: "B", severity: "low", confidence: "low",
      buildImplication: "B", s4Treatment: "affirm", status: "open", createdAt: now,
    });

    // 1. same-tenant read returns exactly own rows
    const ownLedger = await scopedBySession(ctx, "idiosyncrasyLedger", clientA, sessionA);
    report.push({
      check: "same-tenant getLedger(A,A) returns only A",
      pass: ownLedger.length === 1 && (ownLedger[0] as any).summary === "A-secret",
      detail: `count=${ownLedger.length}`,
    });

    // 2. IDOR: A's clientId + B's sessionId must THROW (not leak B)
    report.push({
      check: "IDOR scopedBySession(A, sessionB) throws",
      pass: await expectThrow(() => scopedBySession(ctx, "idiosyncrasyLedger", clientA, sessionB)),
      detail: "cross-tenant ledger read",
    });
    // 3. reverse direction
    report.push({
      check: "IDOR scopedBySession(B, sessionA) throws",
      pass: await expectThrow(() => scopedBySession(ctx, "idiosyncrasyLedger", clientB, sessionA)),
      detail: "cross-tenant ledger read (reverse)",
    });
    // 4. assertSessionInTenant guard direct
    report.push({
      check: "assertSessionInTenant(A, sessionB) throws",
      pass: await expectThrow(() => assertSessionInTenant(ctx, clientA, sessionB)),
      detail: "guard primitive",
    });
    // 5. data-layer: by_session index on sessionA contains ZERO B-tenant rows
    const rawA = await ctx.db.query("idiosyncrasyLedger")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionA)).collect();
    report.push({
      check: "by_session(sessionA) has no foreign-tenant rows",
      pass: rawA.every((r) => r.clientId === clientA),
      detail: `rows=${rawA.length}`,
    });
    // 6. listSessions(A) excludes B's sessions
    const aSessions = await ctx.db.query("sessions")
      .withIndex("by_client", (q) => q.eq("clientId", clientA)).collect();
    report.push({
      check: "listSessions(A) excludes B",
      pass: aSessions.every((s) => s.clientId === clientA) && aSessions.some((s) => s._id === sessionA),
      detail: `count=${aSessions.length}`,
    });

    // 7. session rollup (S3->S4 contract) computes correctly + tenant-scoped
    const ledgerA = (await scopedBySession(
      ctx, "idiosyncrasyLedger", clientA, sessionA,
    )) as unknown as Doc<"idiosyncrasyLedger">[];
    const rollup = computeRollup(sessionA, ledgerA, new Set(["SeakeeperWarranty"]));
    report.push({
      check: "session rollup: counts + hypotheses + must-keep reaction",
      pass:
        rollup.totalIdiosyncrasies === 1 &&
        rollup.highSeverityCount === 1 &&
        rollup.hypotheses.contradicts === 1 &&
        rollup.mustKeepReactedHardest.length === 1 &&
        rollup.mustKeepReactedHardest[0].tool === "SeakeeperWarranty",
      detail: `total=${rollup.totalIdiosyncrasies} high=${rollup.highSeverityCount} contra=${rollup.hypotheses.contradicts}`,
    });

    // --- cleanup (self-cleaning fixture) ---
    for (const t of ["idiosyncrasyLedger", "scenarios", "sessions"] as const) {
      for (const cid of [clientA, clientB]) {
        const rows = await ctx.db.query(t)
          .withIndex("by_client", (q) => q.eq("clientId", cid)).collect();
        for (const r of rows) await ctx.db.delete(r._id);
      }
    }
    await ctx.db.delete(clientA);
    await ctx.db.delete(clientB);

    const passed = report.filter((r) => r.pass).length;
    return { allPass: passed === report.length, passed, total: report.length, report };
  },
});

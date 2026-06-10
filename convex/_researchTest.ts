import { mutation } from "./_generated/server";
import { getProducer, normalizeFindings } from "./researchProducers";
import { _approveBrief, _rejectBrief } from "./researchReview";
import { loadApprovedBrief } from "./research";
import { buildResearchGroundingBlock, RESEARCH_APPROVER_EMAIL } from "./constants";

declare const process: { env: Record<string, string | undefined> };

// ---------------------------------------------------------------------------
// R0 verification: research brief import -> Gate-1 vet -> grounding load.
// One self-cleaning mutation; seeds a client + briefs, exercises the seam +
// normalize rules + approve/supersede/reject + grounding block, asserts, then
// deletes everything it created. DEV-ONLY — refuses to run on production.
// Invoke ONCE over HTTPS (POST /api/mutation `_researchTest:runResearchAudit`).
// ---------------------------------------------------------------------------

export const runResearchAudit = mutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.VIKTOR_SPACES_IS_PREVIEW !== "true") {
      throw new Error("runResearchAudit is a dev-only fixture and is disabled on production.");
    }
    const report: { check: string; pass: boolean; detail: string }[] = [];
    const now = Date.now();
    const APPROVER = RESEARCH_APPROVER_EMAIL;

    // --- seed client ---
    const clientId = await ctx.db.insert("clients", {
      name: "RESEARCH_TEST_co", businessType: "marine services", stackMustKeep: [],
      stackReplaceEasy: [], stackReplaceHard: [], securityTier: "medium",
      status: "active", createdAt: now,
    });

    // --- 1. producer normalize rules (verified-without-source -> inference) ---
    const producer = getProducer("manual");
    const payload = JSON.stringify({
      title: "Marine services — industry context",
      summary: "Public-web scan of small marine-service operators.",
      ownerResearchIncluded: true,
      findings: [
        { topic: "seasonality", claim: "Haul-out demand peaks in spring.", kind: "verified", sources: ["https://example.com/marine"], relevance: "probe seasonal scheduling" },
        { topic: "tooling", claim: "Many shops still run paper work orders.", kind: "inference", sources: [] },
        { topic: "pricing", claim: "Warranty labor is billed at a flat rate.", kind: "verified", sources: [] }, // no source -> downgrade
        { topic: "empty", claim: "  ", kind: "verified", sources: ["x"] }, // dropped (empty claim)
      ],
    });
    const nb = producer.normalize(payload);
    report.push({
      check: "normalize: empty claim dropped, 3 findings kept",
      pass: nb.findings.length === 3,
      detail: `count=${nb.findings.length}`,
    });
    const verifiedCount = nb.findings.filter((f) => f.kind === "verified").length;
    report.push({
      check: "normalize: verified-without-source downgraded to inference (only 1 verified remains)",
      pass: verifiedCount === 1,
      detail: `verified=${verifiedCount}`,
    });

    // --- 2. persist two pending briefs (mirrors importResearchBrief) ---
    const mkBrief = async (title: string) =>
      ctx.db.insert("researchBriefs", {
        clientId, producer: "manual", title, summary: nb.summary,
        findings: nb.findings, ownerResearchIncluded: true, scope: "public-web",
        rawImport: payload, status: "pending", importedBy: "test", importedAt: Date.now(),
      });
    const brief1 = await mkBrief("brief-1");
    const brief2 = await mkBrief("brief-2");

    // --- 3. approve brief1, then brief2 supersedes it ---
    const a1 = await _approveBrief(ctx, brief1, APPROVER, "ok");
    report.push({ check: "approve brief1 -> approved, 0 superseded", pass: a1.status === "approved" && a1.superseded === 0, detail: JSON.stringify(a1) });
    const a2 = await _approveBrief(ctx, brief2, APPROVER);
    report.push({ check: "approve brief2 -> approved, 1 superseded", pass: a2.status === "approved" && a2.superseded === 1, detail: JSON.stringify(a2) });
    const b1 = await ctx.db.get(brief1);
    report.push({ check: "brief1 now superseded", pass: (b1 as any)?.status === "superseded", detail: String((b1 as any)?.status) });

    // --- 4. grounding loader returns the live (brief2) brief ---
    const loaded = await loadApprovedBrief(ctx, clientId);
    report.push({ check: "loadApprovedBrief returns brief2", pass: !!loaded && loaded.briefId === brief2, detail: loaded ? loaded.title : "null" });
    const block = loaded ? buildResearchGroundingBlock(loaded) : "";
    report.push({
      check: "grounding block marks VERIFIED + INFERENCE",
      pass: block.includes("[VERIFIED]") && block.includes("[INFERENCE]"),
      detail: `len=${block.length}`,
    });

    // --- 5. reject path ---
    const brief3 = await mkBrief("brief-3");
    const r3 = await _rejectBrief(ctx, brief3, APPROVER, "not relevant");
    report.push({ check: "reject brief3 -> rejected", pass: r3.status === "rejected", detail: JSON.stringify(r3) });

    // --- 6. double-approve guard (brief1 already superseded, not pending) ---
    let guardThrew = false;
    try { await _approveBrief(ctx, brief1, APPROVER); } catch { guardThrew = true; }
    report.push({ check: "approve non-pending brief throws", pass: guardThrew, detail: `threw=${guardThrew}` });

    // --- 7. sanity on the normalize helper directly ---
    const { downgraded } = normalizeFindings([{ claim: "x", kind: "verified", sources: [] }]);
    report.push({ check: "normalizeFindings reports downgrade count", pass: downgraded === 1, detail: `downgraded=${downgraded}` });

    // --- cleanup (self-cleaning) ---
    for (const id of [brief1, brief2, brief3]) await ctx.db.delete(id);
    await ctx.db.delete(clientId);

    const passed = report.filter((r) => r.pass).length;
    return { ok: passed === report.length, passed, total: report.length, approver: APPROVER, report };
  },
});

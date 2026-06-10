import { action, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";

declare const process: { env: Record<string, string | undefined> };

// R2 create->queue loop proof. Exercises the REAL paths the Import control uses:
// research.listClients (dropdown), research.importResearchBrief (manual path),
// research.listClientBriefs (vet queue read). Deterministic + no LLM cost (the
// live extraction is already covered by _researchSmokeTest). Self-cleaning;
// DEV-ONLY (refuses on prod). Invoke via POST /api/action.

export const _seedImportClient = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.insert("clients", {
      name: "__import_test_client__",
      businessType: "marine-services",
      stackMustKeep: [],
      stackReplaceEasy: [],
      stackReplaceHard: [],
      securityTier: "medium",
      status: "active",
      createdAt: Date.now(),
    });
  },
});

export const _cleanupImport = internalMutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, args) => {
    const briefs = await ctx.db
      .query("researchBriefs")
      .withIndex("by_client", (q) => q.eq("clientId", args.clientId))
      .collect();
    for (const b of briefs) await ctx.db.delete(b._id);
    await ctx.db.delete(args.clientId);
  },
});

const SAMPLE_MANUAL = JSON.stringify({
  title: "Manual import test",
  summary: "s",
  ownerResearchIncluded: true,
  findings: [
    { topic: "a", claim: "sourced claim", kind: "verified", sources: ["https://src.example/a"], relevance: "r" },
    { topic: "b", claim: "unsourced claim", kind: "verified", relevance: "r" }, // -> downgrade
    { topic: "c", claim: "reasoned claim", kind: "inference", relevance: "r" },
  ],
});

export const runImportLoop = action({
  args: {},
  handler: async (ctx) => {
    if (process.env.VIKTOR_SPACES_IS_PREVIEW !== "true") {
      throw new Error("runImportLoop is a dev-only fixture and is disabled on production.");
    }
    const report: Array<{ check: string; pass: boolean; detail: string }> = [];
    const clientId = await ctx.runMutation(internal._researchImportTest._seedImportClient, {});
    try {
      const clients = await ctx.runQuery(api.research.listClients, {});
      report.push({
        check: "listClients returns the active client (dropdown source)",
        pass: clients.some((c) => c.clientId === clientId),
        detail: `n=${clients.length}`,
      });

      const imported = await ctx.runMutation(api.research.importResearchBrief, {
        clientId,
        producer: "manual",
        raw: SAMPLE_MANUAL,
        importedBy: "import-test@frankdataconsultants.com",
      });
      report.push({
        check: "manual import persists; unsourced 'verified' downgraded",
        pass:
          imported.status === "pending" &&
          imported.findingCount === 3 &&
          imported.verifiedCount === 1 &&
          imported.inferenceCount === 2,
        detail: `status=${imported.status} f=${imported.findingCount} v=${imported.verifiedCount} i=${imported.inferenceCount}`,
      });

      const briefs = await ctx.runQuery(api.research.listClientBriefs, { clientId });
      const pending = briefs.filter((b) => b.status === "pending");
      report.push({
        check: "brief appears in client's queue as PENDING (vet loop closed)",
        pass: pending.length === 1 && pending[0].briefId === imported.briefId,
        detail: `pending=${pending.length}`,
      });
    } finally {
      await ctx.runMutation(internal._researchImportTest._cleanupImport, { clientId });
    }
    return { ok: report.every((r) => r.pass), passed: report.filter((r) => r.pass).length, total: report.length, report };
  },
});

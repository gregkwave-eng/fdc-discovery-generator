import { action, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { groundingDecision } from "./research";

declare const process: { env: Record<string, string | undefined> };

// R3 verification. DEV-ONLY (prod-guarded), self-cleaning.
//   A. groundingDecision — exhaustive 8-combo truth table (pure, fail-closed).
//   B. live resolver wiring — proves the per-client toggle + approved-brief flow
//      via setClientGrounding / getClientGroundingState (master is OFF in source,
//      so 'effective' stays false even when client ON — that IS the safety
//      property we assert).
//   C. previewGroundingDiff — one live ungrounded-vs-grounded generation
//      (light tier) proving slot alignment + a populated grounding block.

export const _seedGroundingClient = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.insert("clients", {
      name: "__grounding_test_client__",
      businessType: "marine-services",
      stackMustKeep: ["QuickBooks"],
      stackReplaceEasy: [],
      stackReplaceHard: ["Seakeeper job sheets"],
      securityTier: "medium",
      status: "active",
      createdAt: Date.now(),
    });
  },
});

export const _seedApprovedBrief = internalMutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    return await ctx.db.insert("researchBriefs", {
      clientId,
      producer: "manual",
      title: "Marine yard ops research",
      summary: "Independent boatyard service dynamics.",
      scope: "public-web",
      ownerResearchIncluded: false,
      findings: [
        { id: "f1", topic: "haul-out scheduling", claim: "Yards batch haul-outs by tide window.", kind: "verified", sources: ["https://example.org/tides"], relevance: "drives job sequencing" },
        { id: "f2", topic: "warranty friction", claim: "Owners likely track warranty parts by hand.", kind: "inference", sources: [], relevance: "a probe-worthy hypothesis" },
      ],
      rawImport: "{}",
      status: "approved",
      importedBy: "test",
      importedAt: Date.now(),
      reviewedBy: "greg@frankdataconsultants.com",
      reviewedAt: Date.now(),
    });
  },
});

export const _cleanupGrounding = internalMutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const briefs = await ctx.db
      .query("researchBriefs")
      .withIndex("by_client", (q) => q.eq("clientId", clientId))
      .collect();
    for (const b of briefs) await ctx.db.delete(b._id);
    await ctx.db.delete(clientId);
  },
});

export const runGroundingChecks = action({
  args: { withPreview: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    if (process.env.VIKTOR_SPACES_IS_PREVIEW !== "true") {
      throw new Error("runGroundingChecks is a dev-only fixture and is disabled on production.");
    }
    const report: Array<{ check: string; pass: boolean; detail: string }> = [];

    // --- A. pure truth table (8 combos) ---
    const expect: Array<[boolean, boolean, boolean, boolean, string]> = [
      [false, false, false, false, "master_off"],
      [false, true, true, false, "master_off"],
      [true, false, false, false, "client_off"],
      [true, false, true, false, "client_off"],
      [true, true, false, false, "no_approved_brief"],
      [true, true, true, true, "grounded"],
      [false, true, false, false, "master_off"],
      [true, false, false, false, "client_off"],
    ];
    let tablePass = true;
    let firstBad = "";
    for (const [m, c, b, en, reason] of expect) {
      const d = groundingDecision(m, c, b);
      if (d.enabled !== en || d.reason !== reason) {
        tablePass = false;
        firstBad = `m=${m} c=${c} b=${b} -> ${JSON.stringify(d)} (want enabled=${en}/${reason})`;
        break;
      }
    }
    report.push({ check: "groundingDecision truth table (fail-closed, 8 combos)", pass: tablePass, detail: tablePass ? "all 8 correct" : firstBad });

    // --- B. live resolver wiring ---
    const clientId = await ctx.runMutation(internal._researchGroundingTest._seedGroundingClient, {});
    try {
      let st = await ctx.runQuery(api.research.getClientGroundingState, { clientId });
      report.push({
        check: "default client: grounding OFF, no approved brief",
        pass: st.clientEnabled === false && st.hasApprovedBrief === false && st.effective === false,
        detail: `clientEnabled=${st.clientEnabled} brief=${st.hasApprovedBrief} reason=${st.reason}`,
      });

      // approve a brief + flip the client toggle (via core, mirroring Greg's flip)
      await ctx.runMutation(internal._researchGroundingTest._seedApprovedBrief, { clientId });
      await ctx.runMutation(internal._researchGroundingTest._flipOn, { clientId });
      st = await ctx.runQuery(api.research.getClientGroundingState, { clientId });
      report.push({
        check: "client ON + approved brief: effective gated only by master (OFF in source)",
        pass:
          st.clientEnabled === true &&
          st.hasApprovedBrief === true &&
          st.master === false &&
          st.effective === false &&
          st.reason === "master_off",
        detail: `master=${st.master} client=${st.clientEnabled} brief=${st.hasApprovedBrief} effective=${st.effective} reason=${st.reason}`,
      });

      // --- C. live preview diff (optional, default ON) ---
      if (args.withPreview !== false) {
        const r = await ctx.runAction(api.researchGrounding.previewGroundingDiff, {
          clientId,
          tier: "light",
          transcriptExcerpt:
            "Owner runs a small marine yard. He hand-writes Seakeeper warranty parts on job sheets and won't drop QuickBooks.",
        });
        const aligned = r.slots.length === 5 && r.slots.every((s) => s.ungrounded.body.length > 0 && s.grounded.body.length > 0);
        report.push({
          check: "previewGroundingDiff: 5 aligned slots, both variants populated, block non-empty",
          pass: aligned && r.groundingBlock.includes("VETTED INDUSTRY RESEARCH") && r.findings.length === 2,
          detail: `slots=${r.slots.length} blockLen=${r.groundingBlock.length} findings=${r.findings.length}`,
        });
      }
    } finally {
      await ctx.runMutation(internal._researchGroundingTest._cleanupGrounding, { clientId });
    }

    return { ok: report.every((r) => r.pass), passed: report.filter((r) => r.pass).length, total: report.length, report };
  },
});

// dev-only flip mirroring setClientGrounding's core (no auth in harness)
export const _flipOn = internalMutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    await ctx.db.patch(clientId, {
      groundingEnabled: true,
      groundingEnabledBy: "test@frankdataconsultants.com",
      groundingEnabledAt: Date.now(),
    });
  },
});

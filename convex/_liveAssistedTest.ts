import { mutation } from "./_generated/server";
import { enterLiveAssistedCore, finalizeCore } from "./review";
import type { Id } from "./_generated/dataModel";

declare const process: { env: Record<string, string | undefined> };
function devOnly() {
  if (process.env.VIKTOR_SPACES_IS_PREVIEW !== "true") throw new Error("dev-only fixture.");
}

// Sub-step (e) verification: live-assisted entry + Decision #3 completion floor.
// Self-cleaning. DEV-only — remove pre-prod.

export const runLiveAssistedSuite = mutation({
  args: {},
  handler: async (ctx) => {
    devOnly();
    const report: { check: string; pass: boolean; detail: string }[] = [];
    const push = (check: string, pass: boolean, detail = "") => report.push({ check, pass, detail });
    const now = Date.now();

    const clientId = await ctx.db.insert("clients", {
      name: "LA_suite", businessType: "marine", stackMustKeep: [], stackReplaceEasy: [],
      stackReplaceHard: [], securityTier: "medium", status: "active", createdAt: now,
    });

    // helper: build a session at `status` with N scenarios, `sub` of them substantive-answered
    const build = async (status: string, n: number, sub: number) => {
      const sessionId = await ctx.db.insert("sessions", {
        clientId, depthTier: "standard", status: status as any, createdAt: now,
        fdcApprovedBy: "greg@frankdataconsultants.com", fdcApprovedAt: now,
      });
      for (let i = 0; i < n; i++) {
        const sc = await ctx.db.insert("scenarios", { clientId, sessionId, idx: i, isWildcard: false, title: "t", body: "b", status: "answered" });
        await ctx.db.insert("responses", { clientId, sessionId, scenarioId: sc, modality: "text", text: i < sub ? "a real grounded answer here" : "idk", substantive: i < sub, createdAt: now });
      }
      return sessionId;
    };
    const statusOf = async (id: Id<"sessions">) => (await ctx.db.get(id))!.status;

    // 1) enter live-assisted from escalated sets resolution + transitions
    const esc = await build("escalated", 4, 1);
    await enterLiveAssistedCore(ctx, esc, "graham@frankdataconsultants.com");
    const escDoc = await ctx.db.get(esc);
    push("escalated -> live_assisted + resolution=live_assisted",
      escDoc?.status === "live_assisted" && escDoc?.escalationResolution === "live_assisted",
      `status=${escDoc?.status} res=${escDoc?.escalationResolution}`);

    // 2) finalize floor: >=70% -> complete
    const full = await build("running", 10, 8); // 80%
    const r1 = await finalizeCore(ctx, full, "greg@frankdataconsultants.com");
    push("80% substantive -> finalize complete", r1.outcome === "complete" && (await statusOf(full)) === "complete", JSON.stringify(r1));

    // 3) finalize floor: 50%–70% -> partial(flagged)
    const part = await build("running", 10, 6); // 60%
    const r2 = await finalizeCore(ctx, part, "greg@frankdataconsultants.com");
    const partDoc = await ctx.db.get(part);
    push("60% substantive -> finalize partial + flagged", r2.outcome === "partial" && partDoc?.status === "partial" && partDoc?.escalationResolution === "partial", JSON.stringify(r2));

    // 4) finalize floor: <50% -> below_floor, NO terminal transition
    const low = await build("live_assisted", 10, 3); // 30%
    const r3 = await finalizeCore(ctx, low, "greg@frankdataconsultants.com");
    push("30% substantive -> below_floor, stays live_assisted", r3.outcome === "below_floor" && (await statusOf(low)) === "live_assisted", JSON.stringify(r3));

    // 5) finalize rejects a non-in-progress session (terminal/complete)
    let threw = false;
    try { await finalizeCore(ctx, full, "greg@frankdataconsultants.com"); } catch { threw = true; }
    push("finalize on an already-complete session rejected", threw);

    // 6) illegal: cannot enter live_assisted from a terminal (complete) session
    let threw2 = false;
    try { await enterLiveAssistedCore(ctx, full, "x@frankdataconsultants.com"); } catch { threw2 = true; }
    push("live-assisted entry from terminal(complete) rejected", threw2);

    // cleanup
    for (const sid of [esc, full, part, low]) {
      for (const t of ["scenarios", "responses", "sessionAudit"] as const) {
        const rows = await ctx.db.query(t).withIndex("by_session", (q: any) => q.eq("sessionId", sid)).collect();
        for (const r of rows) await ctx.db.delete(r._id);
      }
      await ctx.db.delete(sid);
    }
    await ctx.db.delete(clientId);

    return { allPass: report.every((r) => r.pass), total: report.length, passed: report.filter((r) => r.pass).length, report };
  },
});

import { mutation } from "./_generated/server";
import { recordTransition, canTransition, TransitionError, type SessionStatus } from "./transitions";

declare const process: { env: Record<string, string | undefined> };

// ---------------------------------------------------------------------------
// Sub-step (a) verification: session state machine + audit trail.
// One self-cleaning mutation: seed a session, walk the legal lifecycle (asserts
// each transition + that an audit row is written per change), assert illegal
// jumps throw, then delete everything seeded. Invoke ONCE over HTTPS.
// DEV-only fixture — remove before production promote.
// ---------------------------------------------------------------------------

export const runTransitionsAudit = mutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.VIKTOR_SPACES_IS_PREVIEW !== "true") {
      throw new Error("runTransitionsAudit is a dev-only fixture and is disabled on production.");
    }
    const report: { check: string; pass: boolean; detail: string }[] = [];
    const now = Date.now();

    // --- pure guard-table checks (deterministic, no DB) -------------------
    const guardCases: [string, string, boolean][] = [
      ["draft", "generated", true],
      ["draft", "complete", false], // can't skip the gates
      ["generated", "running", false], // must pass Gate 1 + Gate 2
      ["fdc_approved", "running", false], // must Begin (owner_approved) first
      ["fdc_approved", "owner_approved", true],
      ["owner_approved", "running", true],
      ["running", "complete", true],
      ["running", "escalated", true],
      ["escalated", "partial", true],
      ["escalated", "live_assisted", true],
      ["complete", "running", false], // terminal
    ];
    for (const [f, t, want] of guardCases) {
      const got = canTransition(f, t);
      report.push({
        check: `guard ${f}->${t}`,
        pass: got === want,
        detail: `canTransition=${got} want=${want}`,
      });
    }

    // --- seed a session ----------------------------------------------------
    const clientId = await ctx.db.insert("clients", {
      name: "TRANSITIONS_TEST_client",
      businessType: "marine",
      stackMustKeep: [],
      stackReplaceEasy: [],
      stackReplaceHard: [],
      securityTier: "medium",
      status: "active",
      createdAt: now,
    });
    const sessionId = await ctx.db.insert("sessions", {
      clientId,
      depthTier: "standard",
      status: "draft",
      createdAt: now,
    });

    // --- walk the legal lifecycle -----------------------------------------
    const walk: [SessionStatus, string][] = [
      ["generated", "scenario_gen"],
      ["fdc_approved", "fdc_approve"],
      ["owner_approved", "owner_begin"],
      ["running", "owner_answer"],
      ["complete", "gate_b_complete"],
    ];
    let walkOk = true;
    for (const [to, action] of walk) {
      try {
        const r = await recordTransition(ctx, { sessionId, to, action, actor: "system" });
        if (!r.changed) walkOk = false;
      } catch (e) {
        walkOk = false;
        report.push({ check: `walk ->${to}`, pass: false, detail: String(e) });
      }
    }
    const finalSession = await ctx.db.get(sessionId);
    report.push({
      check: "legal walk draft->complete",
      pass: walkOk && finalSession?.status === "complete",
      detail: `final status=${finalSession?.status}`,
    });

    // --- audit trail written (one row per change) -------------------------
    const audit = await ctx.db
      .query("sessionAudit")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    report.push({
      check: "audit rows == 5 transitions",
      pass: audit.length === 5,
      detail: `rows=${audit.length} [${audit.map((a) => `${a.fromStatus}->${a.toStatus}`).join(", ")}]`,
    });

    // --- illegal transition throws (runtime, before any write) ------------
    let threw = false;
    try {
      await recordTransition(ctx, { sessionId, to: "running", action: "bad", actor: "system" });
    } catch (e) {
      threw = e instanceof TransitionError;
    }
    report.push({
      check: "illegal complete->running throws TransitionError",
      pass: threw,
      detail: threw ? "rejected" : "NOT rejected (breach)",
    });
    // confirm the failed attempt wrote nothing new
    const auditAfter = await ctx.db
      .query("sessionAudit")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect();
    report.push({
      check: "illegal attempt wrote no audit row",
      pass: auditAfter.length === 5,
      detail: `rows=${auditAfter.length}`,
    });

    // --- cleanup (self-cleaning) ------------------------------------------
    for (const a of auditAfter) await ctx.db.delete(a._id);
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

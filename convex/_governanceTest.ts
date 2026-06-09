import { action, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  businessDaysBetween,
  evaluateSession,
  REMINDER_LADDER_BDAYS,
  STALL_ESCALATE_BDAYS,
} from "./governance";

declare const process: { env: Record<string, string | undefined> };
function devOnly() {
  if (process.env.VIKTOR_SPACES_IS_PREVIEW !== "true") throw new Error("dev-only fixture.");
}
const DAY = 86_400_000;

// Sub-step (d) verification harnesses. DEV-only — remove before prod.

export const runGovernanceUnit = mutation({
  args: {},
  handler: async () => {
    devOnly();
    const report: { check: string; pass: boolean; detail: string }[] = [];
    const push = (check: string, pass: boolean, detail: string) => report.push({ check, pass, detail });

    // anchor a known Monday (12:00) so weekday offsets are exact
    let m = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
    while (m.getUTCDay() !== 1) m = new Date(m.getTime() + DAY);
    const mon = m.getTime();

    // businessDaysBetween
    push("bdays same instant = 0", businessDaysBetween(mon, mon) === 0, `${businessDaysBetween(mon, mon)}`);
    push("bdays Mon->Tue = 1", businessDaysBetween(mon, mon + DAY) === 1, `${businessDaysBetween(mon, mon + DAY)}`);
    push("bdays Fri->Mon = 1 (skips weekend)", businessDaysBetween(mon + 4 * DAY, mon + 7 * DAY) === 1, `${businessDaysBetween(mon + 4 * DAY, mon + 7 * DAY)}`);
    push("bdays Mon->next Mon = 5", businessDaysBetween(mon, mon + 7 * DAY) === 5, `${businessDaysBetween(mon, mon + 7 * DAY)}`);

    const base = { remindersSent: 0, answered: 0, substantiveFraction: 0 };
    const ev = (o: Partial<typeof base> & { status: string; anchorAt: number; now: number }) =>
      evaluateSession({ ...base, ...o });

    // not live
    push("complete session -> none", ev({ status: "complete", anchorAt: mon, now: mon }).action === "none", "");

    // reminder ladder
    const r1 = ev({ status: "owner_approved", anchorAt: mon, now: mon + 2 * DAY, remindersSent: 0 }); // 2 bdays
    push("T+2 bdays, 0 sent -> remind rung 1", r1.action === "remind" && (r1 as any).rung === 1, JSON.stringify(r1));
    const r2 = ev({ status: "running", anchorAt: mon, now: mon + 4 * DAY, remindersSent: 1 }); // 4 bdays
    push("T+4 bdays, 1 sent -> remind rung 2", r2.action === "remind" && (r2 as any).rung === 2, JSON.stringify(r2));
    const r3 = ev({ status: "running", anchorAt: mon, now: mon + 8 * DAY, remindersSent: 2 }); // 6 bdays
    push("T+6 bdays, 2 sent -> remind rung 3", r3.action === "remind" && (r3 as any).rung === 3, JSON.stringify(r3));
    const r0 = ev({ status: "running", anchorAt: mon, now: mon + 4 * DAY, remindersSent: 2 }); // 4 bdays, both sent
    push("rungs already sent -> none", r0.action === "none", JSON.stringify(r0));

    // stall
    const st = ev({ status: "running", anchorAt: mon, now: mon + 11 * DAY }); // >=7 bdays
    push("T+7 bdays -> escalate stall", st.action === "escalate" && (st as any).reason === "stall", JSON.stringify(st));

    // off-script (priority, time-independent)
    const os = ev({ status: "running", anchorAt: mon, now: mon, answered: 3, substantiveFraction: 0.3 });
    push(">=3 answered & <40% substantive -> escalate off_script", os.action === "escalate" && (os as any).reason === "off_script", JSON.stringify(os));
    const okThin = ev({ status: "running", anchorAt: mon, now: mon, answered: 3, substantiveFraction: 0.5 });
    push("3 answered & 50% substantive (fresh) -> none", okThin.action === "none", JSON.stringify(okThin));

    push("constants: ladder=[2,4,6], stall=7", JSON.stringify(REMINDER_LADDER_BDAYS) === "[2,4,6]" && STALL_ESCALATE_BDAYS === 7, "");

    return { allPass: report.every((r) => r.pass), total: report.length, passed: report.filter((r) => r.pass).length, report };
  },
});

export const _devSeedGovernance = mutation({
  args: {},
  handler: async (ctx) => {
    devOnly();
    const now = Date.now();
    const clientId = await ctx.db.insert("clients", {
      name: "GOV_E2E_seed", businessType: "marine", stackMustKeep: [], stackReplaceEasy: [],
      stackReplaceHard: [], securityTier: "medium", status: "active", createdAt: now,
    });
    // (1) stalled running session: last activity 14 calendar days ago
    const stalled = await ctx.db.insert("sessions", {
      clientId, depthTier: "light", status: "running",
      invitedAt: now - 15 * DAY, lastOwnerActivityAt: now - 14 * DAY, remindersSent: 3, createdAt: now - 16 * DAY,
    });
    const sc1 = await ctx.db.insert("scenarios", { clientId, sessionId: stalled, idx: 0, isWildcard: false, title: "a", body: "b", status: "answered" });
    await ctx.db.insert("responses", { clientId, sessionId: stalled, scenarioId: sc1, modality: "text", text: "ok", substantive: true, createdAt: now - 14 * DAY });

    // (2) off-script running session: 3 thin answers (none substantive)
    const offscript = await ctx.db.insert("sessions", {
      clientId, depthTier: "standard", status: "running", invitedAt: now - 1 * DAY, lastOwnerActivityAt: now, createdAt: now - 1 * DAY,
    });
    for (let i = 0; i < 3; i++) {
      const sc = await ctx.db.insert("scenarios", { clientId, sessionId: offscript, idx: i, isWildcard: false, title: "t", body: "b", status: "answered" });
      await ctx.db.insert("responses", { clientId, sessionId: offscript, scenarioId: sc, modality: "text", text: "idk", substantive: false, createdAt: now });
    }

    // (3) healthy fresh session: just begun, no escalation expected
    const healthy = await ctx.db.insert("sessions", {
      clientId, depthTier: "light", status: "owner_approved", invitedAt: now, ownerConsentedAt: now, lastOwnerActivityAt: now, createdAt: now,
    });
    return { clientId, stalled, offscript, healthy };
  },
});

export const _devRunSweep = action({
  args: {},
  handler: async (ctx): Promise<{ reminded: number; escalated: number; scanned: number }> => {
    devOnly();
    return await ctx.runAction(internal.governance.sweepGovernance, {});
  },
});

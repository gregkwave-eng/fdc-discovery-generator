// ---------------------------------------------------------------------------
// Owner-session governance sweep (Decisions #1, #4, #6).
//
// A daily Convex cron evaluates every LIVE owner session and:
//   - Reminder ladder at T+2 / +4 / +6 business days of inactivity (Decision #1).
//     Owner reminder EMAILS are HELD behind the OFF flag — the ladder records
//     state now and will send once Greg flips owner-email on.
//   - Stall escalation at T+7 business days with no completion (Decision #1).
//   - Off-script escalation: >=3 answered AND <40% substantive (Decision #4).
// Escalations flip the session to `escalated` (audited) and leave a pending
// Slack-to-FDC alert (escalatedAt set, fdcAlertedAt null) for the FDC ops layer
// to deliver — owner emails stay HELD (Decision #6).
//
// The decision logic is a PURE function (evaluateSession) so it is unit-testable
// with synthetic inputs, mirroring rollup.ts. The cron just applies decisions.
// ---------------------------------------------------------------------------

import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { recordTransition } from "./transitions";

export const REMINDER_LADDER_BDAYS = [2, 4, 6];
export const STALL_ESCALATE_BDAYS = 7;
export const OFFSCRIPT_MIN_ANSWERED = 3;
export const OFFSCRIPT_SUBSTANTIVE_FLOOR = 0.4;
const OWNER_EMAIL_ENABLED = false; // Decision #6 — owner emails HELD until Greg flips.

const DAY_MS = 86_400_000;

/** Whole business days (Mon–Fri) elapsed between two instants. Day-granularity. */
export function businessDaysBetween(fromMs: number, toMs: number): number {
  if (toMs <= fromMs) return 0;
  const startOfDay = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  let cur = startOfDay(fromMs);
  const end = startOfDay(toMs);
  let count = 0;
  while (cur < end) {
    cur += DAY_MS;
    const dow = new Date(cur).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

export type SweepInput = {
  status: string;
  anchorAt: number; // lastOwnerActivityAt ?? invitedAt ?? createdAt
  remindersSent: number;
  answered: number;
  substantiveFraction: number;
  now: number;
};

export type SweepDecision =
  | { action: "none" }
  | { action: "remind"; rung: number; bdays: number }
  | { action: "escalate"; reason: "stall" | "off_script"; bdays: number };

export function evaluateSession(i: SweepInput): SweepDecision {
  // Only live (begun / in-progress) sessions are swept.
  if (i.status !== "owner_approved" && i.status !== "running") return { action: "none" };

  // Off-script takes priority: enough answered to judge, but mostly thin.
  if (i.answered >= OFFSCRIPT_MIN_ANSWERED && i.substantiveFraction < OFFSCRIPT_SUBSTANTIVE_FLOOR) {
    return { action: "escalate", reason: "off_script", bdays: 0 };
  }

  const bdays = businessDaysBetween(i.anchorAt, i.now);
  if (bdays >= STALL_ESCALATE_BDAYS) return { action: "escalate", reason: "stall", bdays };

  // Reminder ladder: fire the highest reached rung not yet sent.
  for (let k = REMINDER_LADDER_BDAYS.length - 1; k >= 0; k--) {
    if (bdays >= REMINDER_LADDER_BDAYS[k] && i.remindersSent < k + 1) {
      return { action: "remind", rung: k + 1, bdays };
    }
  }
  return { action: "none" };
}

// --- data access ------------------------------------------------------------

export const _liveSessions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const out: {
      sessionId: Id<"sessions">;
      clientId: Id<"clients">;
      status: string;
      anchorAt: number;
      remindersSent: number;
      answered: number;
      substantiveFraction: number;
    }[] = [];
    for (const st of ["owner_approved", "running"] as const) {
      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_status", (q) => q.eq("status", st))
        .collect();
      for (const s of sessions) {
        const responses = await ctx.db
          .query("responses")
          .withIndex("by_session", (q) => q.eq("sessionId", s._id))
          .collect();
        const answered = responses.length;
        const substantive = responses.filter((r) => r.substantive).length;
        out.push({
          sessionId: s._id,
          clientId: s.clientId,
          status: s.status,
          anchorAt: s.lastOwnerActivityAt ?? s.invitedAt ?? s.createdAt,
          remindersSent: s.remindersSent ?? 0,
          answered,
          substantiveFraction: answered > 0 ? substantive / answered : 0,
        });
      }
    }
    return out;
  },
});

export const _applyRemind = internalMutation({
  args: { sessionId: v.id("sessions"), rung: v.number() },
  handler: async (ctx, { sessionId, rung }) => {
    const s = await ctx.db.get(sessionId);
    if (!s) return;
    const now = Date.now();
    await ctx.db.patch(sessionId, { remindersSent: rung, lastReminderAt: now });
    await ctx.db.insert("sessionAudit", {
      clientId: s.clientId,
      sessionId,
      fromStatus: s.status,
      toStatus: s.status,
      action: `owner_reminder_${rung}`,
      actor: "system",
      note: OWNER_EMAIL_ENABLED ? "reminder emailed" : "reminder due (owner email held OFF)",
      at: now,
    });
    // if (OWNER_EMAIL_ENABLED) { send via Resend here once Greg flips it on. }
  },
});

export const _applyEscalate = internalMutation({
  args: { sessionId: v.id("sessions"), reason: v.union(v.literal("stall"), v.literal("off_script")) },
  handler: async (ctx, { sessionId, reason }) => {
    const now = Date.now();
    await recordTransition(ctx, {
      sessionId,
      to: "escalated",
      action: `escalate_${reason}`,
      actor: "system",
      note: reason === "stall" ? "no owner activity past T+7 business days" : "answers thin (<40% substantive)",
      patch: { escalationReason: reason, escalatedAt: now },
    });
    // fdcAlertedAt left null → picked up by the Slack-to-FDC delivery layer.
  },
});

export const sweepGovernance = internalAction({
  args: {},
  handler: async (ctx): Promise<{ reminded: number; escalated: number; scanned: number }> => {
    const live = await ctx.runQuery(internal.governance._liveSessions, {});
    const now = Date.now();
    let reminded = 0;
    let escalated = 0;
    for (const s of live) {
      const d = evaluateSession({ ...s, now });
      if (d.action === "remind") {
        await ctx.runMutation(internal.governance._applyRemind, { sessionId: s.sessionId, rung: d.rung });
        reminded++;
      } else if (d.action === "escalate") {
        await ctx.runMutation(internal.governance._applyEscalate, {
          sessionId: s.sessionId,
          reason: d.reason,
        });
        escalated++;
      }
    }
    return { reminded, escalated, scanned: live.length };
  },
});

// --- Slack-to-FDC delivery seam ---------------------------------------------
// Escalated sessions awaiting an FDC Slack alert (escalatedAt set, not yet
// delivered). The FDC ops layer reads this, posts to Slack, then marks alerted.
// Metadata only (no secrets / no owner answer text).

export const pendingFdcAlerts = query({
  args: {},
  handler: async (ctx) => {
    const escalated = await ctx.db
      .query("sessions")
      .withIndex("by_status", (q) => q.eq("status", "escalated"))
      .collect();
    const out = [];
    for (const s of escalated) {
      if (s.fdcAlertedAt) continue;
      const client = await ctx.db.get(s.clientId);
      const responses = await ctx.db
        .query("responses")
        .withIndex("by_session", (q) => q.eq("sessionId", s._id))
        .collect();
      const answered = responses.length;
      const substantive = responses.filter((r) => r.substantive).length;
      out.push({
        sessionId: s._id,
        clientName: client?.name ?? "(unknown)",
        reason: s.escalationReason ?? "stall",
        escalatedAt: s.escalatedAt ?? null,
        answered,
        substantiveFraction: answered > 0 ? substantive / answered : 0,
      });
    }
    return out;
  },
});

export const markFdcAlerted = mutation({
  args: { sessionIds: v.array(v.id("sessions")) },
  handler: async (ctx, { sessionIds }) => {
    const now = Date.now();
    for (const id of sessionIds) {
      const s = await ctx.db.get(id);
      if (s && !s.fdcAlertedAt) await ctx.db.patch(id, { fdcAlertedAt: now });
    }
    return { marked: sessionIds.length };
  },
});

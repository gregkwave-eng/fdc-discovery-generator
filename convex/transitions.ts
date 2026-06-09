// ---------------------------------------------------------------------------
// Session state machine (Decision #7 two-step hard gate + Decision #9 escalation).
//
// Canonical, single source of truth for *which* status transitions are legal.
// Every status change MUST go through `recordTransition` so that (1) illegal
// jumps throw, and (2) an append-only `sessionAudit` row is written — that's
// what makes the two human gates provable after the fact.
//
//   draft -> generated -> fdc_approved -> owner_approved -> running -> complete
//                              ^Gate 1 (FDC)     ^Gate 2 (owner Begin)
//
// Decision #9 fallbacks branch off owner_approved/running:
//   * escalated      — flagged to FDC (stall/off-script); awaits a human decision
//   * partial        — proceed with what we have (>=50% substantive floor)
//   * live_assisted  — FDC runs the remainder on the owner's behalf
// ---------------------------------------------------------------------------

import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

export type SessionStatus =
  | "draft"
  | "generated"
  | "fdc_approved"
  | "owner_approved"
  | "running"
  | "complete"
  | "partial"
  | "live_assisted"
  | "escalated";

// Allowed forward edges. Self-loops (e.g. running answers that don't change
// status) are handled as no-ops by recordTransition, not listed here.
export const ALLOWED: Record<SessionStatus, SessionStatus[]> = {
  draft: ["generated"],
  generated: ["generated", "fdc_approved"], // generated->generated = regenerate/edit
  fdc_approved: ["generated", "owner_approved"], // FDC reject -> regen; owner Begin -> owner_approved
  owner_approved: ["running", "complete", "escalated", "live_assisted"],
  running: ["complete", "partial", "escalated", "live_assisted"],
  escalated: ["running", "partial", "live_assisted"], // re-engage / proceed-partial / convert
  live_assisted: ["complete", "partial"],
  complete: [],
  partial: [],
};

export function canTransition(from: string, to: string): boolean {
  const edges = ALLOWED[from as SessionStatus];
  return !!edges && edges.includes(to as SessionStatus);
}

export class TransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal session transition: ${from} -> ${to}`);
    this.name = "TransitionError";
  }
}

/**
 * Guarded status transition + append-only audit row, run in the caller's
 * transaction. If `to` equals the current status it is treated as a no-op for
 * the status field (still applies `patch`, and audits only when `auditNoop`).
 */
export async function recordTransition(
  ctx: MutationCtx,
  opts: {
    sessionId: Id<"sessions">;
    to: SessionStatus;
    action: string;
    actor: string;
    note?: string;
    patch?: Partial<Doc<"sessions">>;
    auditNoop?: boolean; // write an audit row even when from === to
  },
): Promise<{ from: string; to: SessionStatus; changed: boolean }> {
  const session = await ctx.db.get(opts.sessionId);
  if (!session) throw new Error("Session not found.");
  const from = session.status as string;

  if (from === opts.to) {
    // Same-state no-op (e.g. an additional answer while already running).
    if (opts.patch) await ctx.db.patch(opts.sessionId, opts.patch);
    if (opts.auditNoop) {
      await ctx.db.insert("sessionAudit", {
        clientId: session.clientId,
        sessionId: opts.sessionId,
        fromStatus: from,
        toStatus: opts.to,
        action: opts.action,
        actor: opts.actor,
        note: opts.note,
        at: Date.now(),
      });
    }
    return { from, to: opts.to, changed: false };
  }

  if (!canTransition(from, opts.to)) throw new TransitionError(from, opts.to);

  const patch: Partial<Doc<"sessions">> = { status: opts.to, ...(opts.patch ?? {}) };
  await ctx.db.patch(opts.sessionId, patch);
  await ctx.db.insert("sessionAudit", {
    clientId: session.clientId,
    sessionId: opts.sessionId,
    fromStatus: from,
    toStatus: opts.to,
    action: opts.action,
    actor: opts.actor,
    note: opts.note,
    at: Date.now(),
  });
  return { from, to: opts.to, changed: true };
}

// Internal wrapper so other server modules / the dev test harness can drive a
// transition via ctx.runMutation. Not publicly callable.
export const applyTransition = internalMutation({
  args: {
    sessionId: v.id("sessions"),
    to: v.string(),
    action: v.string(),
    actor: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { sessionId, to, action, actor, note }) => {
    return await recordTransition(ctx, {
      sessionId,
      to: to as SessionStatus,
      action,
      actor,
      note,
    });
  },
});

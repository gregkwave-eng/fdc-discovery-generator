import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Tenancy guards — the single choke point for tenant + session isolation.
// Every owner/session-scoped read or write MUST go through these. The rule:
//   1. a session belongs to exactly one client (tenant);
//   2. a caller scoped to (clientId, sessionId) may only touch rows whose
//      clientId AND sessionId both match;
//   3. any mismatch THROWS (never silently returns another tenant's rows).
// This is what makes the B.4 IDOR criterion ("cross-tenant read returns 0
// rows") structurally true rather than convention.
// ---------------------------------------------------------------------------

export class TenancyError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "TenancyError";
  }
}

/** Load a session and assert it belongs to `clientId`. Throws on any mismatch. */
export async function assertSessionInTenant(
  ctx: QueryCtx | MutationCtx,
  clientId: Id<"clients">,
  sessionId: Id<"sessions">,
) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.clientId !== clientId) {
    // Identical error for "missing" and "wrong tenant" so existence isn't leaked.
    throw new TenancyError("session not found in tenant");
  }
  return session;
}

/** Assert a child row (scenario/response/ledger) is inside (clientId, sessionId). */
export function assertRowInScope(
  row: { clientId: Id<"clients">; sessionId: Id<"sessions"> } | null,
  clientId: Id<"clients">,
  sessionId: Id<"sessions">,
) {
  if (!row || row.clientId !== clientId || row.sessionId !== sessionId) {
    throw new TenancyError("row not found in scope");
  }
  return row;
}

/**
 * Tenant- AND session-scoped fetch over a `by_session` index, with a defensive
 * clientId re-check on every row (belt-and-suspenders against a forged
 * sessionId that somehow matched a different tenant's data).
 */
export async function scopedBySession(
  ctx: QueryCtx | MutationCtx,
  table: "scenarios" | "responses" | "idiosyncrasyLedger",
  clientId: Id<"clients">,
  sessionId: Id<"sessions">,
) {
  // assertSessionInTenant is the primary gate; the clientId re-filter below is
  // the second layer (belt-and-suspenders against a forged sessionId).
  await assertSessionInTenant(ctx, clientId, sessionId);
  const rows = await ctx.db
    .query(table)
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  return rows.filter((r) => r.clientId === clientId);
}

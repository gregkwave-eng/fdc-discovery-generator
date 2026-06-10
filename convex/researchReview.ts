// ---------------------------------------------------------------------------
// FDC Stage 3 — Gate-1 Research Brief vetting (§5 R-phase, R0)
//
// Mirrors review.ts: FDC reviewers authenticate via Convex Auth (domain
// allow-list @frankdataconsultants.com). VISIBILITY (list/get) is open to any
// FDC reviewer (Graham + Lyle included). APPROVE / REJECT are restricted to the
// SOLE Gate-1 approver, Greg (RESEARCH_APPROVER_EMAIL) — §5.
//
// Approving a brief SUPERSEDES any previously-approved brief for that client, so
// at most one brief is ever live for grounding.
// ---------------------------------------------------------------------------

import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { RESEARCH_APPROVER_EMAIL } from "./constants";

// --- auth helpers -----------------------------------------------------------
async function requireReviewerEmail(ctx: {
  auth: { getUserIdentity: () => Promise<unknown> };
  db: { get: (id: Id<"users">) => Promise<Doc<"users"> | null> };
}): Promise<string> {
  const userId = await getAuthUserId(ctx as never);
  if (!userId) throw new Error("Not authenticated as an FDC reviewer.");
  const user = await ctx.db.get(userId as Id<"users">);
  const email = (user as { email?: string } | null)?.email;
  return String(email ?? "fdc:unknown");
}

function requireApprover(email: string): void {
  if (email.trim().toLowerCase() !== RESEARCH_APPROVER_EMAIL.toLowerCase()) {
    throw new Error(
      `Research-brief approval is restricted to the Gate-1 approver (${RESEARCH_APPROVER_EMAIL}). You have visibility only.`,
    );
  }
}

// --- core logic (shared by auth mutations + dev harness) --------------------
export async function _approveBrief(
  ctx: any,
  briefId: Id<"researchBriefs">,
  email: string,
  note?: string,
) {
  const brief = await ctx.db.get(briefId);
  if (!brief) throw new Error("Research brief not found.");
  if (brief.status !== "pending") {
    throw new Error(`Only a pending brief can be approved (this one is ${brief.status}).`);
  }
  // Supersede any prior approved brief for this client.
  const priorApproved = await ctx.db
    .query("researchBriefs")
    .withIndex("by_client_status", (q: any) =>
      q.eq("clientId", brief.clientId).eq("status", "approved"),
    )
    .collect();
  for (const p of priorApproved) {
    await ctx.db.patch(p._id, { status: "superseded" });
  }
  await ctx.db.patch(briefId, {
    status: "approved",
    reviewedBy: email,
    reviewedAt: Date.now(),
    reviewNote: note,
  });
  return { status: "approved" as const, superseded: priorApproved.length };
}

export async function _rejectBrief(
  ctx: any,
  briefId: Id<"researchBriefs">,
  email: string,
  note: string,
) {
  const brief = await ctx.db.get(briefId);
  if (!brief) throw new Error("Research brief not found.");
  if (brief.status !== "pending") {
    throw new Error(`Only a pending brief can be rejected (this one is ${brief.status}).`);
  }
  await ctx.db.patch(briefId, {
    status: "rejected",
    reviewedBy: email,
    reviewedAt: Date.now(),
    reviewNote: note,
  });
  return { status: "rejected" as const };
}

// --- queries (visibility — any FDC reviewer) --------------------------------
export const listResearchReviewQueue = query({
  args: {},
  handler: async (ctx) => {
    await requireReviewerEmail(ctx);
    const pending = await ctx.db
      .query("researchBriefs")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    const out = [];
    for (const b of pending) {
      const client = await ctx.db.get(b.clientId);
      out.push({
        briefId: b._id,
        clientName: client?.name ?? "(unknown)",
        businessType: client?.businessType ?? "",
        producer: b.producer,
        title: b.title,
        findingCount: b.findings.length,
        verifiedCount: b.findings.filter((f) => f.kind === "verified").length,
        inferenceCount: b.findings.filter((f) => f.kind === "inference").length,
        ownerResearchIncluded: b.ownerResearchIncluded,
        importedAt: b.importedAt,
      });
    }
    return out.sort((a, b) => a.importedAt - b.importedAt);
  },
});

export const getResearchBrief = query({
  args: { briefId: v.id("researchBriefs") },
  handler: async (ctx, { briefId }) => {
    await requireReviewerEmail(ctx);
    const b = await ctx.db.get(briefId);
    if (!b) throw new Error("Research brief not found.");
    const client = await ctx.db.get(b.clientId);
    return {
      briefId: b._id,
      clientId: b.clientId,
      client: client ? { name: client.name, businessType: client.businessType } : null,
      producer: b.producer,
      title: b.title,
      summary: b.summary,
      scope: b.scope,
      ownerResearchIncluded: b.ownerResearchIncluded,
      status: b.status,
      findings: b.findings,
      importedBy: b.importedBy,
      importedAt: b.importedAt,
      reviewedBy: b.reviewedBy ?? null,
      reviewedAt: b.reviewedAt ?? null,
      reviewNote: b.reviewNote ?? null,
    };
  },
});

// --- auth-gated mutations (Greg-only approve/reject) ------------------------
export const approveResearchBrief = mutation({
  args: { briefId: v.id("researchBriefs"), note: v.optional(v.string()) },
  handler: async (ctx, { briefId, note }) => {
    const email = await requireReviewerEmail(ctx);
    requireApprover(email);
    return await _approveBrief(ctx, briefId, email, note);
  },
});

export const rejectResearchBrief = mutation({
  args: { briefId: v.id("researchBriefs"), note: v.string() },
  handler: async (ctx, { briefId, note }) => {
    const email = await requireReviewerEmail(ctx);
    requireApprover(email);
    return await _rejectBrief(ctx, briefId, email, note);
  },
});

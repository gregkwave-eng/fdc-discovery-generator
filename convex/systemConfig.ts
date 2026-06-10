// ---------------------------------------------------------------------------
// Runtime secret store (systemConfig table).
//
// WHY: third-party app secrets (Anthropic, Deepgram, Resend, Turnstile, HMAC)
// cannot be written to the PROD Convex deployment ENV from the sandbox — there
// is no prod deploy key, and `.env.local` does NOT propagate to prod (proven by
// canary). The established pattern (die-analyzer prod) is to store secrets as DB
// rows and read them with a `process.env.X ?? systemConfig.get("X")` fallback.
//
// SECURITY:
//  - `getInternal` is an INTERNAL query — secret VALUES are never client-readable.
//  - `configCheck` returns booleans only (presence), never values.
//  - `bootstrapSeed` is guarded by knowledge of the owner-held HMAC_SECRET
//    (first seed trusts the HMAC being set; later writes must match the stored
//    HMAC) and is the path used to seed prod once after deploy.
//  - `ownerSetConfig` is guarded by Convex-Auth owner identity (the Gate-1
//    approver) for later per-key rotation from the authenticated UI.
// ---------------------------------------------------------------------------

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { RESEARCH_APPROVER_EMAIL } from "./constants";

declare const process: { env: Record<string, string | undefined> };

/** The runtime secrets this app may resolve from env-or-systemConfig. */
export const SECRET_KEYS = [
  "ANTHROPIC_API_KEY",
  "DEEPGRAM_API_KEY",
  "RESEND_API_KEY",
  "TURNSTILE_SECRET_KEY",
  "HMAC_SECRET",
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

// constant-time compare for equal-length strings (admin-token / secret checks)
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// resolveSecret — the fallback readers use. Env first (dev has all 5 wired),
// then the systemConfig table (how prod is seeded). Returns null if neither.
// Call from an ACTION ctx (needs runQuery).
// ---------------------------------------------------------------------------
export async function resolveSecret(
  ctx: { runQuery: (ref: any, args: any) => Promise<any> },
  name: SecretKey,
): Promise<string | null> {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const fromDb = (await ctx.runQuery(internal.systemConfig.getInternal, { key: name })) as
    | string
    | null;
  return fromDb && fromDb.length > 0 ? fromDb : null;
}

/** Internal-only secret read (value). NOT exposed to clients. */
export const getInternal = internalQuery({
  args: { key: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query("systemConfig")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    return row?.value ?? null;
  },
});

/** Presence check (booleans only — never values). Used to verify wiring. */
export const configCheck = query({
  args: {},
  returns: v.object({
    present: v.object({
      ANTHROPIC_API_KEY: v.boolean(),
      DEEPGRAM_API_KEY: v.boolean(),
      RESEND_API_KEY: v.boolean(),
      TURNSTILE_SECRET_KEY: v.boolean(),
      HMAC_SECRET: v.boolean(),
    }),
    count: v.number(),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("systemConfig").collect();
    const have = new Set(rows.filter((r) => (r.value ?? "").length > 0).map((r) => r.key));
    const present = {
      ANTHROPIC_API_KEY: have.has("ANTHROPIC_API_KEY"),
      DEEPGRAM_API_KEY: have.has("DEEPGRAM_API_KEY"),
      RESEND_API_KEY: have.has("RESEND_API_KEY"),
      TURNSTILE_SECRET_KEY: have.has("TURNSTILE_SECRET_KEY"),
      HMAC_SECRET: have.has("HMAC_SECRET"),
    };
    const count = Object.values(present).filter(Boolean).length;
    return { present, count };
  },
});

// shared upsert (no auth; callers must guard)
async function upsert(
  ctx: { db: any },
  key: string,
  value: string,
  updatedBy: string,
): Promise<void> {
  const existing = await ctx.db
    .query("systemConfig")
    .withIndex("by_key", (q: any) => q.eq("key", key))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { value, updatedBy, updatedAt: Date.now() });
  } else {
    await ctx.db.insert("systemConfig", { key, value, updatedBy, updatedAt: Date.now() });
  }
}

/**
 * Seed/rotate the secret store. Guarded by knowledge of the owner-held
 * HMAC_SECRET: on the first seed the provided HMAC_SECRET is trusted; on every
 * later call the adminToken must equal the CURRENTLY-stored HMAC_SECRET. This
 * lets the operator who holds the HMAC seed prod once after deploy, while an
 * external party (who does not know it) cannot write.
 */
export const bootstrapSeed = mutation({
  args: {
    adminToken: v.string(),
    secrets: v.object({
      ANTHROPIC_API_KEY: v.optional(v.string()),
      DEEPGRAM_API_KEY: v.optional(v.string()),
      RESEND_API_KEY: v.optional(v.string()),
      TURNSTILE_SECRET_KEY: v.optional(v.string()),
      HMAC_SECRET: v.optional(v.string()),
    }),
  },
  returns: v.object({ seeded: v.array(v.string()) }),
  handler: async (ctx, { adminToken, secrets }) => {
    const storedHmac =
      (
        await ctx.db
          .query("systemConfig")
          .withIndex("by_key", (q) => q.eq("key", "HMAC_SECRET"))
          .first()
      )?.value ?? null;
    // First seed trusts the HMAC being set; subsequent writes must match stored.
    const expected = storedHmac ?? secrets.HMAC_SECRET ?? null;
    if (!expected || !timingSafeEqual(adminToken, expected)) {
      throw new Error("Unauthorized: adminToken does not match the owner HMAC secret.");
    }
    const seeded: string[] = [];
    for (const key of SECRET_KEYS) {
      const val = secrets[key];
      if (val && val.length > 0) {
        await upsert(ctx, key, val, "bootstrap");
        seeded.push(key);
      }
    }
    return { seeded };
  },
});

// --- owner-authed single-key rotation (for the authenticated UI) ------------
async function requireApproverEmail(ctx: {
  auth: { getUserIdentity: () => Promise<unknown> };
  db: { get: (id: Id<"users">) => Promise<Doc<"users"> | null> };
}): Promise<string> {
  const userId = await getAuthUserId(ctx as never);
  if (!userId) throw new Error("Not authenticated as an FDC reviewer.");
  const user = await ctx.db.get(userId as Id<"users">);
  const email = String((user as { email?: string } | null)?.email ?? "").trim().toLowerCase();
  if (email !== RESEARCH_APPROVER_EMAIL.toLowerCase()) {
    throw new Error(`Config changes are restricted to ${RESEARCH_APPROVER_EMAIL}.`);
  }
  return email;
}

/**
 * Admin cascade-delete a client (sessions + scenarios/responses/sessionAudit),
 * guarded by knowledge of the stored HMAC_SECRET. Exists because the dev
 * cleanup is preview-gated; used to purge throwaway wiring-proof data on prod.
 */
export const adminDeleteClientCascade = mutation({
  args: { adminToken: v.string(), clientId: v.id("clients") },
  returns: v.object({ deletedSessions: v.number(), deletedScenarios: v.number() }),
  handler: async (ctx, { adminToken, clientId }) => {
    const stored =
      (
        await ctx.db
          .query("systemConfig")
          .withIndex("by_key", (q) => q.eq("key", "HMAC_SECRET"))
          .first()
      )?.value ?? null;
    if (!stored || !timingSafeEqual(adminToken, stored)) {
      throw new Error("Unauthorized: adminToken does not match the owner HMAC secret.");
    }
    let deletedScenarios = 0;
    const sessions = await ctx.db
      .query("sessions")
      .filter((q) => q.eq(q.field("clientId"), clientId))
      .collect();
    for (const s of sessions) {
      for (const t of ["scenarios", "responses", "sessionAudit"] as const) {
        const rows = await ctx.db
          .query(t)
          .withIndex("by_session", (q: any) => q.eq("sessionId", s._id))
          .collect();
        for (const r of rows) {
          await ctx.db.delete(r._id);
          if (t === "scenarios") deletedScenarios++;
        }
      }
      await ctx.db.delete(s._id);
    }
    await ctx.db.delete(clientId);
    return { deletedSessions: sessions.length, deletedScenarios };
  },
});

export const ownerSetConfig = mutation({
  args: { key: v.string(), value: v.string() },
  returns: v.null(),
  handler: async (ctx, { key, value }) => {
    const email = await requireApproverEmail(ctx);
    if (!(SECRET_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Unknown config key: ${key}`);
    }
    await upsert(ctx, key, value, `owner:${email}`);
    return null;
  },
});

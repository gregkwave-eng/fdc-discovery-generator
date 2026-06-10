// ---------------------------------------------------------------------------
// HMAC-guarded reviewer-account seeding.
//
// Reviewer sign-up normally requires an email-verification round-trip
// (Password `verify: ViktorSpacesEmail`). To hand a reviewer working creds
// without depending on email delivery, this action creates a Convex Auth
// password account directly (via the official `createAccount` helper, so the
// secret is hashed exactly like a real sign-up) and marks it email-verified so
// sign-in completes immediately. Guarded by the owner-held HMAC_SECRET, the
// same gate used by the other admin mutations.
// ---------------------------------------------------------------------------
import { createAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery } from "./_generated/server";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const _hmacMatches = internalQuery({
  args: { token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { token }) => {
    const stored =
      (
        await ctx.db
          .query("systemConfig")
          .withIndex("by_key", (q) => q.eq("key", "HMAC_SECRET"))
          .first()
      )?.value ?? null;
    return stored !== null && timingSafeEqual(token, stored);
  },
});

export const _markVerified = internalMutation({
  args: { accountId: v.id("authAccounts"), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { accountId, email }) => {
    await ctx.db.patch(accountId, { emailVerified: email });
    return null;
  },
});

// Seed (or report-existing) a reviewer password account. Idempotent: if the
// account already exists it is left untouched and reported as existed:true.
export const adminSeedReviewer = action({
  args: { adminToken: v.string(), email: v.string(), password: v.string() },
  returns: v.object({ email: v.string(), existed: v.boolean() }),
  handler: async (ctx, { adminToken, email, password }) => {
    const ok = await ctx.runQuery(internal.adminSeed._hmacMatches, { token: adminToken });
    if (!ok) throw new Error("Unauthorized: adminToken does not match the owner HMAC secret.");
    const normalized = email.trim().toLowerCase();
    try {
      const { account } = await createAccount(ctx, {
        provider: "password",
        account: { id: normalized, secret: password },
        profile: { email: normalized },
        shouldLinkViaEmail: true,
      });
      await ctx.runMutation(internal.adminSeed._markVerified, {
        accountId: account._id,
        email: normalized,
      });
      return { email: normalized, existed: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already/i.test(msg)) return { email: normalized, existed: true };
      throw e;
    }
  },
});

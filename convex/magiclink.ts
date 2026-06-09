// ---------------------------------------------------------------------------
// Phase 3 — Owner magic-link authentication (stateless HMAC bearer tokens).
//
// Owners are NOT @convex-dev/auth users; they are session-scoped guests who
// receive a signed link to react to their scenarios. A token is:
//
//     base64url("<sessionId>.<exp>") + "." + hex(HMAC_SHA256(payload, secret))
//
// Verification recomputes the HMAC (constant-time compare) and checks expiry.
// We also store a SHA-256 hash of the issued token on the session so a link can
// be single-use / revoked (re-issuing rotates the hash, invalidating old links).
// HMAC + SHA live in Convex actions (Web Crypto `crypto.subtle` is available in
// the action runtime, not in queries/mutations).
// ---------------------------------------------------------------------------

import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

declare const process: { env: Record<string, string | undefined> };

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// --- low-level crypto helpers (Web Crypto, action runtime) -----------------

function getSecret(): string {
  const s = process.env.HMAC_SECRET;
  if (!s) throw new Error("HMAC_SECRET is not configured in the Convex env.");
  return s;
}

function toB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return atob(b64);
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return toHex(sig);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(digest);
}

// constant-time string compare (equal length hex strings)
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- internal DB ops --------------------------------------------------------

export const _setMagicLink = internalMutation({
  args: { sessionId: v.id("sessions"), tokenHash: v.string(), expiresAt: v.number() },
  handler: async (ctx, { sessionId, tokenHash, expiresAt }) => {
    await ctx.db.patch(sessionId, {
      magicLinkTokenHash: tokenHash,
      magicLinkExpiresAt: expiresAt,
    });
  },
});

export const _getByMagicHash = internalQuery({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_magic_hash", (q) => q.eq("magicLinkTokenHash", tokenHash))
      .unique();
    if (!session) return null;
    return {
      sessionId: session._id,
      clientId: session.clientId,
      magicLinkExpiresAt: session.magicLinkExpiresAt ?? 0,
    };
  },
});

// --- public actions ---------------------------------------------------------

/** Issue a magic link for a session. Returns the bearer token + relative path. */
export const issueMagicLink = action({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }): Promise<{ token: string; path: string; expiresAt: number }> => {
    const expiresAt = Date.now() + TTL_MS;
    const payload = `${sessionId}.${expiresAt}`;
    const sig = await hmacHex(payload);
    const token = `${toB64Url(new TextEncoder().encode(payload))}.${sig}`;
    const tokenHash = await sha256Hex(token);
    await ctx.runMutation(internal.magiclink._setMagicLink, { sessionId, tokenHash, expiresAt });
    return { token, path: `/respond?token=${encodeURIComponent(token)}`, expiresAt };
  },
});

/**
 * Verify a magic-link token. Returns the scoped sessionId/clientId on success;
 * throws on any failure (bad signature, expired, revoked/rotated, malformed).
 */
export const verifyMagicLink = action({
  args: { token: v.string() },
  handler: async (
    ctx,
    { token },
  ): Promise<{ sessionId: Id<"sessions">; clientId: Id<"clients"> }> => {
    const dot = token.lastIndexOf(".");
    if (dot <= 0) throw new Error("Malformed token.");
    const b64payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    let payload: string;
    try {
      payload = fromB64Url(b64payload);
    } catch {
      throw new Error("Malformed token payload.");
    }
    const expectedSig = await hmacHex(payload);
    if (!timingSafeEqual(sig, expectedSig)) throw new Error("Invalid token signature.");

    const sep = payload.indexOf(".");
    if (sep <= 0) throw new Error("Malformed token payload.");
    const sessionId = payload.slice(0, sep) as Id<"sessions">;
    const exp = Number(payload.slice(sep + 1));
    if (!Number.isFinite(exp) || Date.now() > exp) throw new Error("Token expired.");

    // Bind to the stored hash (single-use / revocation): the live session must
    // still reference THIS token's hash.
    const tokenHash = await sha256Hex(token);
    const row = await ctx.runQuery(internal.magiclink._getByMagicHash, { tokenHash });
    if (!row || row.sessionId !== sessionId) throw new Error("Token revoked or rotated.");
    if (Date.now() > row.magicLinkExpiresAt) throw new Error("Token expired.");

    return { sessionId, clientId: row.clientId };
  },
});

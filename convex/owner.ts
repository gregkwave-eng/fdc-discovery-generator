// ---------------------------------------------------------------------------
// Phase 4 — Owner reaction backend (token-authenticated).
//
// Owners authenticate ONLY via the stateless magic-link token (Phase 3), not
// Convex Auth. Every owner read/write goes through an *action* that re-verifies
// the token (HMAC, server-side) before delegating to an *internal* query/mutation
// scoped to that session. The data ops are internal (never publicly callable),
// so a browser cannot reach session data by guessing IDs — the signed token is
// the only gate.
//
// The frontend never calls these directly; it goes through `lib/ownerBackend.ts`
// (the transport-agnostic seam) so the HMAC path can later move to a Vercel fn
// without touching any component.
// ---------------------------------------------------------------------------

import { action, internalQuery, internalMutation } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { v } from "convex/values";
import { scopedBySession } from "./tenancy";
import { recordTransition } from "./transitions";
import type { Doc, Id } from "./_generated/dataModel";

declare const process: { env: Record<string, string | undefined> };

const SUBSTANTIVE_MIN_WORDS = 8; // Gate B heuristic
const GATE_B_THRESHOLD = 0.7; // session S4-ready when >=70% scenarios substantive

function isSubstantive(text: string): boolean {
  return text.trim().split(/\s+/).filter(Boolean).length >= SUBSTANTIVE_MIN_WORDS;
}

export type OwnerScenario = {
  scenarioId: Id<"scenarios">;
  idx: number;
  title: string;
  body: string;
  isWildcard: boolean;
  status: "pending" | "answered" | "skipped";
  answered: boolean;
  responseText: string | null;
  followUpText: string | null;
};

export type OwnerLoadResult = {
  client: { name: string; businessType: string } | null;
  session: { depthTier: string; status: string; s4Ready: boolean; substantiveFraction: number };
  progress: { answered: number; total: number };
  scenarios: OwnerScenario[];
};

export type OwnerRespondResult = {
  answered: number;
  total: number;
  substantiveCount: number;
  substantiveFraction: number;
  s4Ready: boolean;
};

// --- internal data ops (scoped; not publicly callable) ----------------------

export const _ownerData = internalQuery({
  args: { clientId: v.id("clients"), sessionId: v.id("sessions") },
  handler: async (ctx, { clientId, sessionId }): Promise<OwnerLoadResult> => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new Error("Session not found.");
    const client = await ctx.db.get(clientId);
    const scenarios = ((await scopedBySession(ctx, "scenarios", clientId, sessionId)) as Doc<"scenarios">[]).sort(
      (a, b) => a.idx - b.idx,
    );
    const responses = (await scopedBySession(ctx, "responses", clientId, sessionId)) as Doc<"responses">[];
    const byScenario = new Map(responses.map((r) => [r.scenarioId, r]));
    return {
      client: client ? { name: client.name, businessType: client.businessType } : null,
      session: {
        depthTier: session.depthTier,
        status: session.status,
        s4Ready: session.s4Ready ?? false,
        substantiveFraction: session.substantiveFraction ?? 0,
      },
      progress: { answered: responses.length, total: scenarios.length },
      scenarios: scenarios.map((s) => {
        const r = byScenario.get(s._id);
        return {
          scenarioId: s._id,
          idx: s.idx,
          title: s.title,
          body: s.body,
          isWildcard: s.isWildcard,
          status: s.status,
          answered: !!r,
          responseText: r?.text ?? null,
          followUpText: r?.followUpText ?? null,
        };
      }),
    };
  },
});

export const _ownerInsert = internalMutation({
  args: {
    clientId: v.id("clients"),
    sessionId: v.id("sessions"),
    scenarioId: v.id("scenarios"),
    modality: v.union(v.literal("text"), v.literal("voice")),
    text: v.string(),
    followUpText: v.optional(v.string()),
    voiceRef: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<OwnerRespondResult> => {
    const scenarios = (await scopedBySession(ctx, "scenarios", args.clientId, args.sessionId)) as Doc<"scenarios">[];
    const scenario = scenarios.find((s) => s._id === args.scenarioId);
    if (!scenario) throw new Error("Scenario not in session.");

    // Gate: owners may only answer once the session is actually open for
    // responses (owner has Begun; or re-engaged from an escalation). This is
    // the data-layer enforcement of the Decision #7 two-step gate.
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("Session not found.");
    const OPEN_FOR_RESPONSES = ["owner_approved", "running", "escalated"];
    if (!OPEN_FOR_RESPONSES.includes(session.status)) {
      throw new Error("This discovery session isn't open for responses yet.");
    }

    const substantive = isSubstantive(`${args.text} ${args.followUpText ?? ""}`);
    const responses = (await scopedBySession(ctx, "responses", args.clientId, args.sessionId)) as Doc<"responses">[];
    const existing = responses.find((r) => r.scenarioId === args.scenarioId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        modality: args.modality,
        text: args.text,
        followUpText: args.followUpText,
        voiceRef: args.voiceRef,
        substantive,
        createdAt: Date.now(),
      });
    } else {
      await ctx.db.insert("responses", {
        clientId: args.clientId,
        sessionId: args.sessionId,
        scenarioId: args.scenarioId,
        modality: args.modality,
        text: args.text,
        followUpText: args.followUpText,
        voiceRef: args.voiceRef,
        substantive,
        createdAt: Date.now(),
      });
    }
    await ctx.db.patch(args.scenarioId, { status: "answered" });

    const after = (await scopedBySession(ctx, "responses", args.clientId, args.sessionId)) as Doc<"responses">[];
    const total = scenarios.length;
    const substantiveCount = after.filter((r) => r.substantive).length;
    const substantiveFraction = total > 0 ? substantiveCount / total : 0;
    const s4Ready = substantiveFraction >= GATE_B_THRESHOLD;
    const now = Date.now();

    // Any owner answer first moves a freshly-begun (owner_approved) or
    // re-engaged (escalated) session into `running`; a no-op while already
    // running. Then Gate B (>=70% substantive) flips it to `complete`.
    if (session.status === "owner_approved" || session.status === "escalated") {
      await recordTransition(ctx, {
        sessionId: args.sessionId,
        to: "running",
        action: "owner_answer",
        actor: "owner",
        patch: { lastOwnerActivityAt: now },
      });
    }
    if (s4Ready) {
      await recordTransition(ctx, {
        sessionId: args.sessionId,
        to: "complete",
        action: "gate_b_complete",
        actor: "owner",
        note: `Gate B met: ${substantiveCount}/${total} substantive`,
        patch: { substantiveFraction, s4Ready, lastOwnerActivityAt: now },
      });
    } else {
      await recordTransition(ctx, {
        sessionId: args.sessionId,
        to: "running",
        action: "owner_answer",
        actor: "owner",
        patch: { substantiveFraction, s4Ready, lastOwnerActivityAt: now },
      });
    }

    return { answered: after.length, total, substantiveCount, substantiveFraction, s4Ready };
  },
});

// Gate 2 (owner preview -> Begin): owner consents on the preview screen and
// taps Begin. Advances fdc_approved -> owner_approved. If the session hasn't
// cleared Gate 1 (FDC approval) the transition is illegal and throws, so the
// owner physically cannot start an unapproved session. Idempotent.
export const _ownerBeginMut = internalMutation({
  args: { clientId: v.id("clients"), sessionId: v.id("sessions") },
  handler: async (ctx, { clientId, sessionId }): Promise<{ status: string }> => {
    const session = await ctx.db.get(sessionId);
    if (!session || session.clientId !== clientId) throw new Error("Session not found.");
    if (session.status === "owner_approved" || session.status === "running") {
      return { status: session.status }; // already begun — no-op
    }
    await recordTransition(ctx, {
      sessionId,
      to: "owner_approved",
      action: "owner_begin",
      actor: "owner",
      patch: { ownerConsentedAt: Date.now(), lastOwnerActivityAt: Date.now() },
    });
    return { status: "owner_approved" };
  },
});

// --- public token-authenticated actions (the only owner entry points) -------

export const ownerBegin = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ status: string }> => {
    const { sessionId, clientId } = await ctx.runAction(api.magiclink.verifyMagicLink, { token });
    return await ctx.runMutation(internal.owner._ownerBeginMut, { clientId, sessionId });
  },
});

export const ownerLoad = action({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<OwnerLoadResult> => {
    const { sessionId, clientId } = await ctx.runAction(api.magiclink.verifyMagicLink, { token });
    return await ctx.runQuery(internal.owner._ownerData, { clientId, sessionId });
  },
});

// Voice (Phase 4b): token-verified transcription. Owner records a reply in the
// browser (MediaRecorder); the bytes are posted here, stored in Convex file
// storage (voiceRef, kept for audit/replay), and transcribed via Deepgram. The
// transcript is returned to the client, which then calls `ownerRespond` with
// modality:"voice" + the transcript + voiceRef. Deepgram key is read from the
// Convex env server-side (never exposed to the browser).
export const ownerTranscribe = action({
  args: {
    token: v.string(),
    audio: v.bytes(),
    mimeType: v.optional(v.string()),
  },
  handler: async (ctx, { token, audio, mimeType }): Promise<{ transcript: string; voiceRef: string }> => {
    // Gate on the signed token before doing any work or storing anything.
    await ctx.runAction(api.magiclink.verifyMagicLink, { token });

    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) throw new Error("Transcription unavailable: DEEPGRAM_API_KEY not configured on this deployment.");
    if (!audio || audio.byteLength === 0) throw new Error("No audio captured — please record again.");

    const contentType = mimeType && mimeType.length > 0 ? mimeType : "audio/webm";

    // Persist the raw audio first so we always have the source even if STT fails.
    const voiceRef = await ctx.storage.store(new Blob([audio], { type: contentType }));

    const resp = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true",
      {
        method: "POST",
        headers: { Authorization: `Token ${apiKey}`, "Content-Type": contentType },
        body: audio,
      },
    );
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`Deepgram error ${resp.status}: ${detail.slice(0, 200)}`);
    }
    const data = (await resp.json()) as {
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    };
    const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";

    return { transcript, voiceRef };
  },
});

export const ownerRespond = action({
  args: {
    token: v.string(),
    scenarioId: v.id("scenarios"),
    modality: v.union(v.literal("text"), v.literal("voice")),
    text: v.string(),
    followUpText: v.optional(v.string()),
    voiceRef: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<OwnerRespondResult> => {
    const { sessionId, clientId } = await ctx.runAction(api.magiclink.verifyMagicLink, {
      token: args.token,
    });
    return await ctx.runMutation(internal.owner._ownerInsert, {
      clientId,
      sessionId,
      scenarioId: args.scenarioId,
      modality: args.modality,
      text: args.text,
      followUpText: args.followUpText,
      voiceRef: args.voiceRef,
    });
  },
});

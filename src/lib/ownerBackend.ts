// ---------------------------------------------------------------------------
// Owner backend seam (Phase 4).
//
// The single, transport-agnostic boundary the owner reaction UI uses to talk to
// the backend. Today every method is a Convex action call. The two SECRET /
// HMAC-touching paths — `verifyToken` and `transcribe` — are deliberately
// isolated here so they can later be repointed at a Vercel serverless function
// (env we control via API) for the prod-env / "HMAC verify off the SPA"
// migration WITHOUT touching a single component. That swap is a change to this
// file only; the interfaces below are the stable contract.
// ---------------------------------------------------------------------------

import { ConvexReactClient } from "convex/react";
import { anyApi } from "convex/server";

// `anyApi` keeps this seam decoupled from generated types (the UI imports the
// seam, not raw convex refs). Runtime names match convex/owner.ts + magiclink.ts.
const api = anyApi as any;

export type OwnerScenario = {
  scenarioId: string;
  idx: number;
  title: string;
  body: string;
  isWildcard: boolean;
  status: "pending" | "answered" | "skipped";
  answered: boolean;
  responseText: string | null;
  followUpText: string | null;
};

export type OwnerSession = {
  depthTier: string;
  status: string;
  s4Ready: boolean;
  substantiveFraction: number;
};

export type OwnerLoad = {
  client: { name: string; businessType: string } | null;
  session: OwnerSession;
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

export type TokenScope = { sessionId: string; clientId: string };

export interface OwnerBackend {
  /** SECRET/HMAC path — swap target for the Vercel-fn migration. */
  verifyToken(token: string): Promise<TokenScope>;
  load(token: string): Promise<OwnerLoad>;
  respond(input: {
    token: string;
    scenarioId: string;
    modality: "text" | "voice";
    text: string;
    followUpText?: string;
    voiceRef?: string;
  }): Promise<OwnerRespondResult>;
  /** SECRET path (Deepgram) — swap target for the Vercel-fn migration. */
  transcribe(input: { token: string; audio: Blob }): Promise<{ transcript: string; voiceRef: string }>;
}

/** Default implementation: Convex actions. The only place these refs are used. */
export function createOwnerBackend(client: ConvexReactClient): OwnerBackend {
  return {
    verifyToken: (token) => client.action(api.magiclink.verifyMagicLink, { token }),
    load: (token) => client.action(api.owner.ownerLoad, { token }),
    respond: (input) => client.action(api.owner.ownerRespond, input),
    // Phase 4b: audio bytes → Convex action (stores in file storage + Deepgram
    // STT) → transcript. Later this single method repoints to a Vercel fn; the
    // UI never changes. Deepgram key stays server-side.
    transcribe: async ({ token, audio }) => {
      const buf = await audio.arrayBuffer();
      return client.action(api.owner.ownerTranscribe, {
        token,
        audio: buf,
        mimeType: audio.type || "audio/webm",
      });
    },
  };
}

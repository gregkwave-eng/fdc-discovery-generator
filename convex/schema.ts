import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// FDC Stage 3 — Discovery Session Generator
// Phase 1: multi-tenant data model. Tenant root = `clients`. Every downstream
// row carries `clientId` (tenant) AND its owning `sessionId` so every read can
// be tenant- AND session-isolated. Cross-tenant / cross-session reads must
// return 0 rows (enforced by convex/tenancy.ts guards). See B.4 IDOR criterion.
// ---------------------------------------------------------------------------

const depthTier = v.union(v.literal("light"), v.literal("standard"), v.literal("deep"));

// Session lifecycle (Decision #7 two-step hard gate + Decision #9 escalation).
//   draft -> generated -> fdc_approved -> owner_approved -> running -> complete
// Gate 1 (FDC sign-off on /review) advances generated->fdc_approved.
// Gate 2 (owner preview->Begin) advances fdc_approved->owner_approved.
// Decision #9 fallbacks: escalated (flagged to FDC), partial (>=50% substantive,
// proceed with what we have), live_assisted (FDC runs it on the owner's behalf).
const sessionStatus = v.union(
  v.literal("draft"),
  v.literal("generated"),
  v.literal("fdc_approved"),
  v.literal("owner_approved"),
  v.literal("running"),
  v.literal("complete"),
  v.literal("partial"),
  v.literal("live_assisted"),
  v.literal("escalated"),
);

const severity = v.union(v.literal("high"), v.literal("med"), v.literal("low"));
const confidence = v.union(v.literal("high"), v.literal("med"), v.literal("low"));

const ledgerCategory = v.union(
  v.literal("process-exception"),
  v.literal("tool-attachment"),
  v.literal("terminology"),
  v.literal("compliance/edge-case"),
  v.literal("customer-handling"),
  v.literal("pricing/commercial"),
  v.literal("data-shape"),
  v.literal("trust/control"),
);

const s4Treatment = v.union(
  v.literal("affirm"),
  v.literal("adjust-design"),
  v.literal("flag-risk"),
  v.literal("spotlight"),
);

const schema = defineSchema({
  ...authTables,

  // --- Tenant root ---------------------------------------------------------
  clients: defineTable({
    name: v.string(),
    businessType: v.string(),
    // Stack Census buckets captured at S2 (arrays of tool/system names)
    stackMustKeep: v.array(v.string()),
    stackReplaceEasy: v.array(v.string()),
    stackReplaceHard: v.array(v.string()),
    hypothesisBriefRef: v.optional(v.string()),
    securityTier: v.union(v.literal("medium"), v.literal("hipaa")), // hipaa gate-blocked Build 1
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
  }).index("by_status", ["status"]),

  // --- Sessions (one discovery run per deal) -------------------------------
  sessions: defineTable({
    clientId: v.id("clients"),
    depthTier,
    status: sessionStatus,
    s4Ready: v.optional(v.boolean()), // Gate B runtime flag, set when >=70% substantive
    substantiveFraction: v.optional(v.number()),
    // Phase 3 owner magic-link auth (stateless HMAC). The token itself is the
    // bearer credential; we store only a SHA-256 hash of it for single-use /
    // revocation binding, never the raw token.
    magicLinkTokenHash: v.optional(v.string()),
    magicLinkExpiresAt: v.optional(v.number()),
    // --- Governance / lifecycle metadata (Decision #7 + #9) ---------------
    fdcApprovedBy: v.optional(v.string()), // approver identity (e.g. "greg@frankdataconsultants.com")
    fdcApprovedAt: v.optional(v.number()),
    invitedAt: v.optional(v.number()), // owner-link second-click send (Decision #5)
    ownerConsentedAt: v.optional(v.number()), // owner tapped Begin on the preview (Gate 2)
    lastOwnerActivityAt: v.optional(v.number()), // drives stall detection
    remindersSent: v.optional(v.number()),
    lastReminderAt: v.optional(v.number()),
    escalationReason: v.optional(v.union(v.literal("stall"), v.literal("off_script"))),
    escalatedAt: v.optional(v.number()),
    escalationResolution: v.optional(
      v.union(v.literal("partial"), v.literal("live_assisted"), v.literal("re_engaged")),
    ),
    createdAt: v.number(),
  })
    .index("by_client", ["clientId"])
    .index("by_magic_hash", ["magicLinkTokenHash"])
    .index("by_status", ["status"]),

  // --- Scenarios (vignettes within a session) ------------------------------
  scenarios: defineTable({
    clientId: v.id("clients"),
    sessionId: v.id("sessions"),
    idx: v.number(),
    archetypeKey: v.optional(v.string()),
    isWildcard: v.boolean(),
    title: v.string(),
    body: v.string(),
    status: v.union(v.literal("pending"), v.literal("answered"), v.literal("skipped")),
  })
    .index("by_session", ["sessionId"])
    .index("by_client", ["clientId"]),

  // --- Owner responses (text or voice) -------------------------------------
  responses: defineTable({
    clientId: v.id("clients"),
    sessionId: v.id("sessions"),
    scenarioId: v.id("scenarios"),
    modality: v.union(v.literal("text"), v.literal("voice")),
    text: v.string(), // redacted text only; raw audio never persisted pre-redaction
    voiceRef: v.optional(v.string()),
    followUpText: v.optional(v.string()),
    substantive: v.optional(v.boolean()), // Gate B heuristic result
    createdAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_scenario", ["scenarioId"])
    .index("by_client", ["clientId"]),

  // --- Idiosyncrasy ledger (the S3->S4 contract) ---------------------------
  idiosyncrasyLedger: defineTable({
    clientId: v.id("clients"),
    sessionId: v.id("sessions"),
    scenarioId: v.id("scenarios"),
    summary: v.string(),
    category: ledgerCategory,
    evidenceExcerpt: v.string(),
    voiceTs: v.optional(v.string()),
    linkedStackItem: v.optional(v.string()),
    linkedHypothesis: v.optional(
      v.union(v.literal("confirms"), v.literal("contradicts"), v.literal("new")),
    ),
    severity,
    confidence,
    buildImplication: v.string(),
    s4Treatment,
    status: v.union(v.literal("open"), v.literal("addressed-in-s4")),
    createdAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_client", ["clientId"]),

  // --- Session audit trail (every governance transition, append-only) ------
  // One row per status change: who did what, from->to, when. Powers the
  // /review audit view and makes the two-step gate provable after the fact.
  sessionAudit: defineTable({
    clientId: v.id("clients"),
    sessionId: v.id("sessions"),
    fromStatus: v.string(),
    toStatus: v.string(),
    action: v.string(), // fdc_approve | fdc_reject | regenerate | invite_sent | owner_begin | owner_answer | gate_b_complete | escalate | proceed_partial | convert_live_assisted | re_engage | reminder_sent
    actor: v.string(), // "fdc:<email>" | "owner" | "system"
    note: v.optional(v.string()),
    at: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_client", ["clientId"]),
});

export default schema;

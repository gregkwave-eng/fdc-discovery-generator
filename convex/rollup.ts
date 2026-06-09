import type { Doc, Id } from "./_generated/dataModel";

// Shared session-rollup computation (S3->S4 contract summary). Pure function so
// both the getSessionRollup query and the Phase-1 test fixture exercise the
// identical code path.

const SEV_RANK: Record<string, number> = { high: 0, med: 1, low: 2 };

export function computeRollup(
  sessionId: Id<"sessions">,
  entries: Doc<"idiosyncrasyLedger">[],
  mustKeep: Set<string>,
) {
  const topBySeverity = [...entries]
    .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])
    .slice(0, 5)
    .map((e) => ({ id: e._id, summary: e.summary, severity: e.severity, category: e.category }));

  const hypotheses = { confirms: 0, contradicts: 0, new: 0 };
  for (const e of entries) {
    if (e.linkedHypothesis) hypotheses[e.linkedHypothesis] += 1;
  }

  const mustKeepReactions: Record<string, number> = {};
  for (const e of entries) {
    if (
      e.linkedStackItem &&
      mustKeep.has(e.linkedStackItem) &&
      (e.severity === "high" || e.severity === "med")
    ) {
      mustKeepReactions[e.linkedStackItem] = (mustKeepReactions[e.linkedStackItem] ?? 0) + 1;
    }
  }
  const mustKeepReactedHardest = Object.entries(mustKeepReactions)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => ({ tool, count }));

  return {
    sessionId,
    totalIdiosyncrasies: entries.length,
    highSeverityCount: entries.filter((e) => e.severity === "high").length,
    topBySeverity,
    hypotheses,
    mustKeepReactedHardest,
  };
}

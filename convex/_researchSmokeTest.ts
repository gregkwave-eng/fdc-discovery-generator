import { action } from "./_generated/server";
import { getProducer } from "./researchProducers";
import { extractBriefFromDoc } from "./researchActions";

declare const process: { env: Record<string, string | undefined> };

// R1 live smoke: proves the deep-research path end-to-end through the REAL Claude
// extraction call — the genuinely risky bit (does the model emit JSON the pure
// producer accepts, with the verified-vs-inference discipline intact?). No
// persistence; DEV-ONLY (refuses on prod). Invoke ONCE via POST /api/action.
const SAMPLE_DOC = `# Deep research: Coastal marine-services yard

## Market
According to the National Marine Manufacturers Association (https://www.nmma.org/statistics),
recreational boating contributed over $230B to the US economy in 2023. Haul-out and
winterization demand is strongly seasonal — peaking in spring and fall — per BoatUS
(https://www.boatus.com/expert-advice).

## Operations (inferred)
Most small yards in this segment still coordinate work orders by phone and paper. This is
an inference from the general absence of booking software in the sector, not a sourced fact.

## Owner
The company's About page (https://example-marina.com/about) describes the owner as a former
Coast Guard mechanic who founded the yard in 2009.`;

export const runDeepResearchSmoke = action({
  args: {},
  handler: async () => {
    if (process.env.VIKTOR_SPACES_IS_PREVIEW !== "true") {
      throw new Error("runDeepResearchSmoke is a dev-only fixture and is disabled on production.");
    }
    const { extraction } = await extractBriefFromDoc(SAMPLE_DOC);
    const brief = getProducer("claude-deep-research").normalize(JSON.stringify(extraction));
    const verified = brief.findings.filter((f) => f.kind === "verified");
    const badVerified = verified.filter((f) => f.sources.length === 0);
    const report = [
      { check: "extraction parsed + >=3 findings", pass: brief.findings.length >= 3, detail: `n=${brief.findings.length}` },
      { check: ">=1 verified finding, all with resolved sources", pass: verified.length >= 1 && verified.every((f) => f.sources.length > 0), detail: `verified=${verified.length}` },
      { check: "no 'verified' finding lacks a source (discipline holds)", pass: badVerified.length === 0, detail: `bad=${badVerified.length}` },
      { check: "ownerResearchIncluded is set", pass: typeof brief.ownerResearchIncluded === "boolean", detail: String(brief.ownerResearchIncluded) },
    ];
    return {
      ok: report.every((r) => r.pass),
      report,
      title: brief.title,
      findings: brief.findings.map((f) => ({ kind: f.kind, topic: f.topic, sources: f.sources.length, claim: f.claim.slice(0, 90) })),
    };
  },
});

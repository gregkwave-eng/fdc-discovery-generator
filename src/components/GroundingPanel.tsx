import { useAction, useMutation, useQuery } from "convex/react";
import { GitCompareArrows, Loader2, Power, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const REASON_HELP: Record<string, string> = {
  master_off: "Global master switch (RESEARCH_GROUNDING_ENABLED) is OFF — nothing grounds anywhere.",
  client_off: "This client's grounding toggle is OFF.",
  no_approved_brief: "No Gate-1-approved brief for this client yet.",
  grounded: "Live — generation for this client is grounded against the approved brief.",
};

type PreviewSlot = {
  slot: number;
  label: string;
  isWildcard: boolean;
  ungrounded: { title: string; body: string };
  grounded: { title: string; body: string };
};
type PreviewResult = {
  clientName: string;
  tier: string;
  briefTitle: string;
  findings: Array<{ topic: string; claim: string; kind: "verified" | "inference"; relevance?: string }>;
  groundingBlock: string;
  slots: PreviewSlot[];
};

// R3 — per-client grounding enablement + grounding preview/diff. Mounted in the
// brief detail; keyed by the brief's clientId. Toggle is Greg-only server-side
// (non-approvers see it but the mutation throws → toast).
export function GroundingPanel({ clientId }: { clientId: Id<"clients"> }) {
  const state = useQuery(api.research.getClientGroundingState, { clientId });
  const setGrounding = useMutation(api.researchGrounding.setClientGrounding);
  const preview = useAction(api.researchGrounding.previewGroundingDiff);

  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<PreviewResult | null>(null);

  async function toggle() {
    if (!state) return;
    setBusy(true);
    try {
      await setGrounding({ clientId, enabled: !state.clientEnabled });
      toast.success(`Grounding ${!state.clientEnabled ? "ENABLED" : "disabled"} for ${state.clientName}`);
    } catch (e) {
      toast.error((e as Error).message ?? "Toggle failed");
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    setBusy(true);
    setResult(null);
    try {
      const r = (await preview({
        clientId,
        transcriptExcerpt: transcript.trim() || undefined,
      })) as PreviewResult;
      setResult(r);
      toast.success(`Diff ready — ${r.slots.length} probes (${r.tier} tier)`);
    } catch (e) {
      toast.error((e as Error).message ?? "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  if (state === undefined) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Power className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm">Grounding — {state.clientName}</CardTitle>
        </div>
        <CardDescription>
          Per-client toggle, layered under the global master switch. Flipping this client never
          affects any other client's generation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* status row */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-md border border-border p-2">
            <div className="text-muted-foreground">Master</div>
            <Badge variant={state.master ? "default" : "secondary"} className="mt-1">
              {state.master ? "ON" : "OFF"}
            </Badge>
          </div>
          <div className="rounded-md border border-border p-2">
            <div className="text-muted-foreground">This client</div>
            <Badge variant={state.clientEnabled ? "default" : "secondary"} className="mt-1">
              {state.clientEnabled ? "ON" : "OFF"}
            </Badge>
          </div>
          <div className="rounded-md border border-border p-2">
            <div className="text-muted-foreground">Effective</div>
            <Badge variant={state.effective ? "default" : "secondary"} className="mt-1">
              {state.effective ? "GROUNDED" : "ungrounded"}
            </Badge>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">{REASON_HELP[state.reason] ?? state.reason}</p>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant={state.clientEnabled ? "outline" : "default"}
            disabled={busy}
            onClick={toggle}
          >
            <Power className="mr-1 h-4 w-4" />
            {state.clientEnabled ? "Disable for this client" : "Enable for this client"}
          </Button>
          {state.clientEnabled && !state.master && (
            <span className="flex items-center gap-1 text-[11px] text-amber-600">
              <ShieldAlert className="h-3 w-3" /> Master is OFF — still ungrounded live.
            </span>
          )}
          {state.clientEnabled && !state.hasApprovedBrief && (
            <span className="flex items-center gap-1 text-[11px] text-amber-600">
              <ShieldAlert className="h-3 w-3" /> No approved brief — approve one to go live.
            </span>
          )}
        </div>

        {/* preview / diff */}
        <div className="space-y-2 border-t border-border pt-4">
          <Label className="text-xs">Grounding preview / diff</Label>
          <p className="text-[11px] text-muted-foreground">
            Generates probes <em>ungrounded vs grounded</em> with the identical prompt (only the
            vetted-research block differs) so you can see grounding's effect before/while it's live.
            What-if only — persists nothing. Optionally paste an S2 transcript excerpt for a
            realistic diff.
          </p>
          <Textarea
            rows={4}
            placeholder="Optional: paste an S2 discovery transcript excerpt for a realistic diff…"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            disabled={busy}
            className="text-xs"
          />
          <Button
            size="sm"
            disabled={busy || !state.hasApprovedBrief}
            onClick={runPreview}
            title={state.hasApprovedBrief ? "" : "Approve a brief first"}
          >
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <GitCompareArrows className="mr-1 h-4 w-4" />}
            Run grounding diff
          </Button>
        </div>

        {result && (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="text-xs text-muted-foreground">
              Brief: <span className="font-medium text-foreground">{result.briefTitle}</span> ·{" "}
              {result.tier} tier · {result.slots.length} probes ·{" "}
              {result.findings.filter((f) => f.kind === "verified").length} verified /{" "}
              {result.findings.filter((f) => f.kind === "inference").length} inference
            </div>
            {result.slots.map((s) => (
              <div key={s.slot} className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                  <span>
                    {s.slot}. {s.label}
                  </span>
                  {s.isWildcard && (
                    <Badge variant="outline" className="text-[10px]">Wildcard</Badge>
                  )}
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md bg-muted/40 p-2">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Ungrounded
                    </div>
                    <div className="text-xs font-medium">{s.ungrounded.title}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{s.ungrounded.body}</p>
                  </div>
                  <div className="rounded-md bg-primary/5 p-2 ring-1 ring-primary/20">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">
                      Grounded
                    </div>
                    <div className="text-xs font-medium">{s.grounded.title}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{s.grounded.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

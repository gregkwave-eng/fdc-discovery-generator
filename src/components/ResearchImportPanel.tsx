import { useAction, useMutation, useQuery } from "convex/react";
import { FilePlus2, Loader2, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type Source = "claude-deep-research" | "manual";

const SOURCE_HELP: Record<Source, string> = {
  "claude-deep-research":
    "Paste a Claude deep-research document (markdown). It runs through Claude extraction (public-web scope, verified-only-if-sourced) and lands as a PENDING brief below.",
  manual:
    'Paste a manual brief as JSON: { "title", "summary", "ownerResearchIncluded", "findings": [{ "topic", "claim", "kind": "verified"|"inference", "sources": ["https://…"], "relevance" }] }. Unsourced "verified" findings are auto-downgraded to inference.',
};

// R2 — Import control. Creates + queues only; never grounds generation (grounding
// stays flag-gated + needs Gate-1 approval). Deep-research path fires the
// runDeepResearch action; manual path imports JSON directly. Both land PENDING.
export function ResearchImportPanel() {
  const clients = useQuery(api.research.listClients);
  const me = useQuery(api.auth.currentUser);
  const runDeepResearch = useAction(api.researchActions.runDeepResearch);
  const importBrief = useMutation(api.research.importResearchBrief);

  const [clientId, setClientId] = useState<Id<"clients"> | "">("");
  const [source, setSource] = useState<Source>("claude-deep-research");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = !!clientId && text.trim().length >= 40 && !busy;
  const importedBy = (me as { email?: string } | null | undefined)?.email ?? undefined;

  async function submit() {
    if (!clientId) return;
    setBusy(true);
    try {
      let res: { findingCount: number; verifiedCount: number; inferenceCount: number };
      if (source === "claude-deep-research") {
        res = await runDeepResearch({ clientId, doc: text, importedBy });
      } else {
        res = await importBrief({ clientId, producer: "manual", raw: text, importedBy });
      }
      toast.success(
        `Brief queued — ${res.findingCount} findings (${res.verifiedCount} verified · ${res.inferenceCount} inference). Awaiting Gate-1 vet.`,
      );
      setText("");
    } catch (e) {
      toast.error((e as Error).message ?? "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FilePlus2 className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm">Import a research brief</CardTitle>
        </div>
        <CardDescription>
          Bring research into the vet queue. Creates + queues only — nothing grounds generation
          until you approve it and the grounding flag is on.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Client</Label>
            <Select
              value={clientId}
              onValueChange={(v) => setClientId(v as Id<"clients">)}
              disabled={busy}
            >
              <SelectTrigger>
                <SelectValue placeholder={clients === undefined ? "Loading…" : "Select a client"} />
              </SelectTrigger>
              <SelectContent>
                {clients?.map((c) => (
                  <SelectItem key={c.clientId} value={c.clientId}>
                    {c.name} · {c.businessType}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {clients && clients.length === 0 && (
              <p className="text-xs text-muted-foreground">No active clients yet.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Source</Label>
            <Select value={source} onValueChange={(v) => setSource(v as Source)} disabled={busy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude-deep-research">Claude deep research (doc)</SelectItem>
                <SelectItem value="manual">Manual (JSON)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">{SOURCE_HELP[source]}</p>

        <div className="space-y-1.5">
          <Label>{source === "manual" ? "Brief JSON" : "Deep-research document"}</Label>
          <Textarea
            rows={10}
            placeholder={
              source === "manual"
                ? '{\n  "title": "...",\n  "summary": "...",\n  "ownerResearchIncluded": false,\n  "findings": [ ... ]\n}'
                : "Paste the full Claude deep-research document here…"
            }
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            className="font-mono text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            {text.trim().length < 40
              ? "Needs at least 40 characters."
              : `${text.length.toLocaleString()} characters`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1 h-4 w-4" />
            )}
            {source === "claude-deep-research" ? "Extract & queue" : "Import & queue"}
          </Button>
          {source === "claude-deep-research" && (
            <span className="text-[11px] text-muted-foreground">
              Runs a live extraction — may take ~10–20s.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

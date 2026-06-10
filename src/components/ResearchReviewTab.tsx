import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, FileSearch, Loader2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ResearchImportPanel } from "@/components/ResearchImportPanel";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

function KindBadge({ kind }: { kind: "verified" | "inference" }) {
  return kind === "verified" ? (
    <Badge variant="default" className="text-[10px]">VERIFIED</Badge>
  ) : (
    <Badge variant="secondary" className="text-[10px]">INFERENCE</Badge>
  );
}

function fmt(ts: number | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Gate-1 Research Brief vetting. Visibility for any FDC reviewer; approve/reject
// is enforced server-side to Greg (RESEARCH_APPROVER_EMAIL) — non-approvers see
// the buttons but the mutation throws, surfaced as a toast.
export function ResearchReviewTab() {
  const queue = useQuery(api.researchReview.listResearchReviewQueue);
  const [selectedId, setSelectedId] = useState<Id<"researchBriefs"> | null>(null);
  const detail = useQuery(
    api.researchReview.getResearchBrief,
    selectedId ? { briefId: selectedId } : "skip",
  );
  const approve = useMutation(api.researchReview.approveResearchBrief);
  const reject = useMutation(api.researchReview.rejectResearchBrief);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
    } catch (e) {
      toast.error((e as Error).message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <ResearchImportPanel />
      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      {/* Queue */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Briefs awaiting vet {queue ? `(${queue.length})` : ""}
        </h2>
        {queue === undefined && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {queue && queue.length === 0 && (
          <p className="text-sm text-muted-foreground">No research briefs waiting.</p>
        )}
        {queue?.map((q) => (
          <button
            key={q.briefId}
            onClick={() => {
              setSelectedId(q.briefId);
              setNote("");
            }}
            className={`w-full rounded-lg border p-3 text-left transition hover:border-primary/60 ${
              selectedId === q.briefId ? "border-primary bg-primary/5" : "border-border"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{q.clientName}</span>
              <Badge variant="outline" className="text-[10px]">{q.producer}</Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{q.title}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {q.findingCount} findings · {q.verifiedCount} verified · {q.inferenceCount} inference
              {q.ownerResearchIncluded ? " · owner research" : ""}
            </div>
          </button>
        ))}
      </div>

      {/* Detail */}
      <div>
        {!selectedId && (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Select a brief to vet its findings before it can ground scenario generation.
            </CardContent>
          </Card>
        )}
        {selectedId && detail === undefined && (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
        {selectedId && detail && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>{detail.title}</CardTitle>
                  <CardDescription>
                    {detail.client?.name} · {detail.client?.businessType} · scope: {detail.scope}
                  </CardDescription>
                </div>
                <Badge variant="outline">{detail.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {detail.summary && <p className="text-sm text-muted-foreground">{detail.summary}</p>}

              <div className="space-y-3">
                {detail.findings.map((f) => (
                  <div key={f.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2">
                      <KindBadge kind={f.kind} />
                      <span className="text-xs font-medium text-muted-foreground">{f.topic}</span>
                    </div>
                    <p className="mt-1 text-sm">{f.claim}</p>
                    {f.relevance && (
                      <p className="mt-1 text-xs text-muted-foreground">Why it matters: {f.relevance}</p>
                    )}
                    {f.sources.length > 0 && (
                      <div className="mt-1 space-y-0.5">
                        {f.sources.map((s, i) => (
                          <a
                            key={i}
                            href={s}
                            target="_blank"
                            rel="noreferrer"
                            className="block break-all text-xs text-primary underline"
                          >
                            {s}
                          </a>
                        ))}
                      </div>
                    )}
                    {f.kind === "verified" && f.sources.length === 0 && (
                      <p className="mt-1 text-xs text-destructive">⚠ verified with no source</p>
                    )}
                  </div>
                ))}
              </div>

              {detail.status === "pending" ? (
                <div className="space-y-2 border-t border-border pt-4">
                  <Textarea
                    rows={2}
                    placeholder="Review note (required to reject)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run("Brief approved", async () => {
                          await approve({ briefId: detail.briefId, note: note || undefined });
                          setSelectedId(null);
                        })
                      }
                    >
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy || !note.trim()}
                      onClick={() =>
                        run("Brief rejected", async () => {
                          await reject({ briefId: detail.briefId, note });
                          setSelectedId(null);
                        })
                      }
                    >
                      <X className="mr-1 h-4 w-4" /> Reject
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Approve/reject is restricted to the Gate-1 approver (Greg). Others have visibility only.
                  </p>
                </div>
              ) : (
                <p className="border-t border-border pt-4 text-xs text-muted-foreground">
                  {detail.reviewedBy
                    ? `${detail.status} by ${detail.reviewedBy} · ${fmt(detail.reviewedAt)}`
                    : detail.status}
                  {detail.reviewNote ? ` — ${detail.reviewNote}` : ""}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      </div>
    </div>
  );
}

export const ResearchTabIcon = FileSearch;

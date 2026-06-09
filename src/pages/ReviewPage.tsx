import { useAction, useMutation, useQuery } from "convex/react";
import { CheckCircle2, Loader2, Pencil, RefreshCw, Send, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const STATUS_LABEL: Record<string, string> = {
  generated: "Awaiting approval",
  fdc_approved: "Approved — ready to invite",
  escalated: "Escalated — needs decision",
};

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "fdc_approved" ? "default" : status === "escalated" ? "destructive" : "secondary";
  return <Badge variant={variant}>{STATUS_LABEL[status] ?? status}</Badge>;
}

function fmt(ts: number | null) {
  if (!ts) return "";
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ReviewPage() {
  const queue = useQuery(api.review.listReviewQueue);
  const [selectedId, setSelectedId] = useState<Id<"sessions"> | null>(null);
  const detail = useQuery(
    api.review.getReviewSession,
    selectedId ? { sessionId: selectedId } : "skip",
  );

  const approve = useMutation(api.review.fdcApprove);
  const reject = useMutation(api.review.fdcReject);
  const editScenario = useMutation(api.review.fdcEditScenario);
  const regenerate = useAction(api.review.fdcRegenerate);
  const inviteOwner = useAction(api.review.inviteOwner);

  const [busy, setBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [editing, setEditing] = useState<{ id: Id<"scenarios">; title: string; body: string } | null>(
    null,
  );

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
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Discovery Review</h1>
          <p className="text-sm text-muted-foreground">
            Gate 1 — approve generated scenarios before any owner link is issued.
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Queue */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Needs your eyes {queue ? `(${queue.length})` : ""}
          </h2>
          {queue === undefined && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {queue && queue.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing waiting. All clear.</p>
          )}
          {queue?.map((q) => (
            <button
              key={q.sessionId}
              onClick={() => {
                setSelectedId(q.sessionId);
                setInviteLink(null);
              }}
              className={`w-full rounded-lg border p-3 text-left transition hover:border-primary/60 ${
                selectedId === q.sessionId ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{q.clientName}</span>
                <StatusBadge status={q.status} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {q.businessType} · {q.depthTier} · {q.scenarioCount} scenarios
              </div>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div>
          {!selectedId && (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Select a session to review its scenarios.
              </CardContent>
            </Card>
          )}
          {selectedId && detail === undefined && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
          {selectedId && detail && (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle>{detail.client?.name}</CardTitle>
                      <CardDescription>
                        {detail.client?.businessType} · {detail.session.depthTier} depth
                      </CardDescription>
                    </div>
                    <StatusBadge status={detail.session.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {detail.session.fdcApprovedBy && (
                    <p className="text-xs text-muted-foreground">
                      Approved by {detail.session.fdcApprovedBy} · {fmt(detail.session.fdcApprovedAt)}
                    </p>
                  )}

                  {/* Scenarios */}
                  <div className="space-y-3">
                    {detail.scenarios.map((s) => (
                      <div key={s.scenarioId} className="rounded-lg border border-border p-3">
                        {editing?.id === s.scenarioId ? (
                          <div className="space-y-2">
                            <Input
                              value={editing.title}
                              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                            />
                            <Textarea
                              rows={3}
                              value={editing.body}
                              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() =>
                                  run("Scenario updated", async () => {
                                    await editScenario({
                                      sessionId: detail.session.sessionId,
                                      scenarioId: s.scenarioId,
                                      title: editing.title,
                                      body: editing.body,
                                    });
                                    setEditing(null);
                                  })
                                }
                              >
                                Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold">
                                  {s.idx + 1}. {s.title}
                                </span>
                                {s.isWildcard && (
                                  <Badge variant="outline" className="text-[10px]">
                                    Wildcard
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
                            </div>
                            {(detail.session.status === "generated" ||
                              detail.session.status === "fdc_approved") && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() =>
                                  setEditing({ id: s.scenarioId, title: s.title, body: s.body })
                                }
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <Separator />
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {detail.session.status !== "fdc_approved" && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            run("Approved — Gate 1 cleared", () =>
                              approve({ sessionId: detail.session.sessionId }),
                            )
                          }
                        >
                          <CheckCircle2 className="mr-1 h-4 w-4" /> Approve
                        </Button>
                      )}
                      {detail.session.status === "fdc_approved" && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            run("Owner link issued (not emailed)", async () => {
                              const r = await inviteOwner({ sessionId: detail.session.sessionId });
                              setInviteLink(window.location.origin + r.path);
                            })
                          }
                        >
                          <Send className="mr-1 h-4 w-4" /> Invite owner
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          run("Regenerating scenarios…", () =>
                            regenerate({ sessionId: detail.session.sessionId }),
                          )
                        }
                      >
                        <RefreshCw className="mr-1 h-4 w-4" /> Regenerate
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Reason (sent back for revision)"
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                      />
                      <Button
                        variant="ghost"
                        disabled={busy || !rejectNote.trim()}
                        onClick={() =>
                          run("Sent back for revision", async () => {
                            await reject({
                              sessionId: detail.session.sessionId,
                              note: rejectNote.trim(),
                            });
                            setRejectNote("");
                          })
                        }
                      >
                        <X className="mr-1 h-4 w-4" /> Reject
                      </Button>
                    </div>
                    {inviteLink && (
                      <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-xs">
                        <p className="mb-1 font-medium">
                          Owner link issued — email is held OFF, send this manually:
                        </p>
                        <code className="block break-all text-muted-foreground">{inviteLink}</code>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Audit trail */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Audit trail</CardTitle>
                  <CardDescription>Every governance action on this session.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ol className="space-y-2">
                    {detail.audit.map((a, i) => (
                      <li key={i} className="flex items-baseline gap-3 text-xs">
                        <span className="w-36 shrink-0 text-muted-foreground">{fmt(a.at)}</span>
                        <span className="font-mono">
                          {a.fromStatus}→{a.toStatus}
                        </span>
                        <span className="font-medium">{a.action}</span>
                        <span className="text-muted-foreground">
                          {a.actor}
                          {a.note ? ` — ${a.note}` : ""}
                        </span>
                      </li>
                    ))}
                    {detail.audit.length === 0 && (
                      <li className="text-xs text-muted-foreground">No events yet.</li>
                    )}
                  </ol>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

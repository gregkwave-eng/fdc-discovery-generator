// ---------------------------------------------------------------------------
// Owner reaction surface — PUBLIC, token-gated (Phase 4).
//
// A standalone, self-contained gold-on-charcoal experience (independent of the
// app's light/dark theme). The owner arrives via a magic link (`/respond?token=`),
// reacts to one scenario vignette at a time (text now; voice in 4b), and gets a
// single bounded follow-up nudge when a reply reads thin. All backend access
// goes through the `ownerBackend.ts` seam — never raw convex refs.
// ---------------------------------------------------------------------------

import { useConvex } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createOwnerBackend,
  type OwnerLoad,
  type OwnerScenario,
} from "@/lib/ownerBackend";

const SUBSTANTIVE_MIN_WORDS = 8; // mirrors Gate B; client-side only to nudge a follow-up

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function getToken(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

// --- small presentational atoms --------------------------------------------

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#CBA65A] font-serif text-sm font-bold text-[#15171C]">
        L
      </div>
      <span className="text-[13px] font-medium tracking-[0.18em] text-[#9CA0A8] uppercase">
        Litmus
      </span>
    </div>
  );
}

function ProgressRail({ answered, total }: { answered: number; total: number }) {
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between text-[12px] tracking-wide text-[#9CA0A8]">
        <span>
          {answered} of {total} answered
        </span>
        <span className="text-[#CBA65A]">{pct}%</span>
      </div>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-[#2C2F38]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#CBA65A] to-[#E3C77E] transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full bg-[#15171C] bg-[radial-gradient(120%_120%_at_50%_-10%,#1d212a_0%,#15171C_55%)] text-[#F4F1EA] antialiased">
      <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-5 py-8 sm:px-8 sm:py-12">
        {children}
      </div>
    </div>
  );
}

// --- states -----------------------------------------------------------------

function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="w-full max-w-md rounded-2xl border border-[#2C2F38] bg-[#1E2128]/70 px-8 py-12 shadow-2xl backdrop-blur">
        {children}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <CenterCard>
      <div className="mx-auto mb-5 h-8 w-8 animate-spin rounded-full border-2 border-[#2C2F38] border-t-[#CBA65A]" />
      <p className="text-sm text-[#9CA0A8]">Opening your session…</p>
    </CenterCard>
  );
}

function InvalidState({ message }: { message: string }) {
  return (
    <CenterCard>
      <h1 className="mb-3 font-serif text-2xl text-[#F4F1EA]">This link can’t be opened</h1>
      <p className="text-sm leading-relaxed text-[#9CA0A8]">{message}</p>
      <p className="mt-6 text-[13px] text-[#6E727B]">
        Reach out to your FDC contact and we’ll send a fresh link.
      </p>
    </CenterCard>
  );
}

function DoneState({ data }: { data: OwnerLoad }) {
  return (
    <CenterCard>
      <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[#CBA65A]/15 text-2xl text-[#CBA65A]">
        ✓
      </div>
      <h1 className="mb-3 font-serif text-2xl text-[#F4F1EA]">That’s everything — thank you</h1>
      <p className="text-sm leading-relaxed text-[#9CA0A8]">
        Your reactions are in. We’ll fold them into the mirror of how
        {data.client?.name ? ` ${data.client.name}` : " your business"} actually
        operates, and your FDC team will take it from here.
      </p>
      <p className="mt-6 text-[13px] text-[#6E727B]">You can close this window.</p>
    </CenterCard>
  );
}

function PreviewConsent({
  data,
  onBegin,
  busy,
}: {
  data: OwnerLoad;
  onBegin: () => void;
  busy: boolean;
}) {
  const total = data.progress.total;
  return (
    <CenterCard>
      <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[#CBA65A]/15 text-xl text-[#CBA65A]">
        ◆
      </div>
      <h1 className="mb-3 font-serif text-2xl text-[#F4F1EA]">
        A few moments on how{data.client?.name ? ` ${data.client.name}` : " your business"} really runs
      </h1>
      <p className="text-sm leading-relaxed text-[#9CA0A8]">
        Your FDC team has prepared {total} short, true-to-life situations. There are no right
        answers — we just want to hear how <span className="text-[#C7CAD1]">you</span> handle each
        one, in your own words. You can type or talk, and stop any time.
      </p>
      <ul className="mx-auto mt-5 max-w-xs space-y-2 text-left text-[13px] text-[#9CA0A8]">
        <li className="flex gap-2"><span className="text-[#CBA65A]">·</span> ~5–10 minutes, at your pace</li>
        <li className="flex gap-2"><span className="text-[#CBA65A]">·</span> Private to your engagement team</li>
        <li className="flex gap-2"><span className="text-[#CBA65A]">·</span> Nothing starts until you tap Begin</li>
      </ul>
      <button
        disabled={busy}
        onClick={onBegin}
        className="mt-7 inline-flex items-center gap-2 rounded-xl bg-[#CBA65A] px-6 py-2.5 text-[14px] font-semibold text-[#15171C] transition-all hover:bg-[#E3C77E] disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Starting…" : "Begin"}
        {!busy && <span aria-hidden>→</span>}
      </button>
    </CenterCard>
  );
}

function NotReadyState({ name }: { name?: string }) {
  return (
    <CenterCard>
      <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-[#CBA65A]/10 text-2xl text-[#CBA65A]">
        ⋯
      </div>
      <h1 className="mb-3 font-serif text-2xl text-[#F4F1EA]">Almost ready</h1>
      <p className="text-sm leading-relaxed text-[#9CA0A8]">
        Your FDC team is still putting the finishing touches on
        {name ? ` ${name}'s` : " your"} discovery. This link will come alive as soon as they
        finish — please check back shortly.
      </p>
    </CenterCard>
  );
}

// --- the vignette card ------------------------------------------------------

function VignetteCard({
  scenario,
  index,
  total,
  onSubmit,
  onTranscribe,
  busy,
}: {
  scenario: OwnerScenario;
  index: number;
  total: number;
  onSubmit: (text: string, followUp?: string, voiceRef?: string) => Promise<void>;
  onTranscribe: (audio: Blob) => Promise<{ transcript: string; voiceRef: string }>;
  busy: boolean;
}) {
  const [text, setText] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [askFollowUp, setAskFollowUp] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // voice (Phase 4b)
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [voiceRef, setVoiceRef] = useState<string | undefined>(undefined);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // reset when the scenario changes
  useEffect(() => {
    setText("");
    setFollowUp("");
    setAskFollowUp(false);
    setRecording(false);
    setTranscribing(false);
    setAudioUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
    setVoiceRef(undefined);
    setVoiceError(null);
    stopTracks();
    taRef.current?.focus();
  }, [scenario.scenarioId]);

  // cleanup on unmount
  useEffect(() => () => stopTracks(), []);

  const startRecording = async () => {
    setVoiceError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceError("Recording isn’t supported in this browser — please type your answer.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stopTracks();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        setAudioUrl((u) => {
          if (u) URL.revokeObjectURL(u);
          return URL.createObjectURL(blob);
        });
        setTranscribing(true);
        try {
          const { transcript, voiceRef: ref } = await onTranscribe(blob);
          setVoiceRef(ref);
          if (transcript) {
            setText((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript));
          } else {
            setVoiceError("We couldn’t make out any words — try again, or type your answer.");
          }
        } catch {
          setVoiceError("Transcription failed — your recording is saved; you can type instead or re-record.");
        } finally {
          setTranscribing(false);
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setVoiceError("Microphone access was blocked — please allow it, or type your answer instead.");
      stopTracks();
    }
  };

  const stopRecording = () => {
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    setRecording(false);
  };

  const thin = wordCount(text) < SUBSTANTIVE_MIN_WORDS;

  const handlePrimary = async () => {
    if (!text.trim() || transcribing || recording) return;
    // One bounded follow-up nudge when the first pass reads thin.
    if (thin && !askFollowUp) {
      setAskFollowUp(true);
      return;
    }
    await onSubmit(text.trim(), followUp.trim() || undefined, voiceRef);
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-7 flex items-center gap-3">
        <span className="text-[12px] font-medium tracking-[0.2em] text-[#9CA0A8] uppercase">
          Scenario {index + 1} of {total}
        </span>
        {scenario.isWildcard && (
          <span className="rounded-full border border-[#CBA65A]/40 bg-[#CBA65A]/10 px-2.5 py-0.5 text-[11px] font-medium tracking-wide text-[#E3C77E]">
            Wildcard
          </span>
        )}
      </div>

      <div className="rounded-2xl border border-[#2C2F38] bg-[#1E2128]/70 p-7 shadow-2xl backdrop-blur sm:p-9">
        <h1 className="font-serif text-[26px] leading-snug text-[#F4F1EA] sm:text-[30px]">
          {scenario.title}
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-[#C7CAD1] sm:text-base">
          {scenario.body}
        </p>

        <div className="mt-7">
          <label className="mb-2 block text-[13px] tracking-wide text-[#9CA0A8]">
            How would <span className="text-[#E3C77E]">you</span> actually handle this?
          </label>
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="Tell it like you’d tell a new hire — the real way, not the polished way."
            className="w-full resize-none rounded-xl border border-[#33373F] bg-[#15171C]/80 px-4 py-3 text-[15px] leading-relaxed text-[#F4F1EA] placeholder:text-[#5E626B] focus:border-[#CBA65A]/60 focus:ring-1 focus:ring-[#CBA65A]/40 focus:outline-none"
          />

          {/* Voice (Phase 4b) — talk instead of type; transcript lands above, editable. */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {!recording ? (
              <button
                type="button"
                onClick={startRecording}
                disabled={transcribing || busy}
                className="inline-flex items-center gap-2 rounded-lg border border-[#33373F] bg-transparent px-3.5 py-2 text-[13px] font-medium text-[#C7CAD1] transition-colors hover:border-[#CBA65A]/50 hover:text-[#E3C77E] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="h-2 w-2 rounded-full bg-[#CBA65A]" aria-hidden />
                {transcribing ? "Transcribing…" : audioUrl ? "Re-record" : "Prefer to talk? Record"}
              </button>
            ) : (
              <button
                type="button"
                onClick={stopRecording}
                className="inline-flex items-center gap-2 rounded-lg border border-[#CBA65A]/60 bg-[#CBA65A]/10 px-3.5 py-2 text-[13px] font-medium text-[#E3C77E] transition-colors hover:bg-[#CBA65A]/20"
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#E0584B]" aria-hidden />
                Recording… tap to stop
              </button>
            )}
            {audioUrl && !recording && (
              <audio src={audioUrl} controls className="h-8 max-w-[220px]">
                <track kind="captions" />
              </audio>
            )}
            <span className="text-[12px] text-[#6E727B]">
              {transcribing
                ? "Turning your words into text…"
                : voiceRef
                  ? "Transcribed — edit above, then send."
                  : "We’ll transcribe it; you can edit before sending."}
            </span>
          </div>
          {voiceError && (
            <p className="mt-2 text-[12.5px] text-[#E0884B]">{voiceError}</p>
          )}

          {askFollowUp && (
            <div className="mt-4 rounded-xl border border-[#CBA65A]/30 bg-[#CBA65A]/[0.06] p-4">
              <p className="text-[13.5px] leading-relaxed text-[#E3C77E]">
                One more nudge — what’s the part that’s easy to miss? A step, a
                judgment call, or who you’d loop in.
              </p>
              <textarea
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                rows={3}
                placeholder="The detail that makes it the way you do it."
                className="mt-3 w-full resize-none rounded-lg border border-[#33373F] bg-[#15171C]/80 px-3.5 py-2.5 text-[14px] leading-relaxed text-[#F4F1EA] placeholder:text-[#5E626B] focus:border-[#CBA65A]/60 focus:ring-1 focus:ring-[#CBA65A]/40 focus:outline-none"
              />
            </div>
          )}
        </div>

        <div className="mt-7 flex items-center justify-between gap-4">
          <span className="text-[12px] text-[#6E727B]">
            {askFollowUp ? "Add a line or send as-is — your call." : "Type or talk — whichever's easier."}
          </span>
          <button
            disabled={!text.trim() || busy}
            onClick={handlePrimary}
            title={!text.trim() ? "Write your answer to continue" : undefined}
            className={
              "inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-[14px] font-semibold transition-all " +
              (!text.trim()
                ? "cursor-not-allowed border border-[#33373F] bg-transparent text-[#6E727B]"
                : "bg-[#CBA65A] text-[#15171C] hover:bg-[#E3C77E] disabled:cursor-wait disabled:opacity-60")
            }
          >
            {busy ? "Saving…" : index + 1 === total ? "Finish" : "Continue"}
            {!busy && <span aria-hidden>→</span>}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- page -------------------------------------------------------------------

export function RespondPage() {
  const convex = useConvex();
  const backend = useMemo(() => createOwnerBackend(convex), [convex]);
  const token = useMemo(() => getToken(), []);

  const [data, setData] = useState<OwnerLoad | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0); // index into unanswered scenarios

  const refresh = useCallback(async () => {
    if (!token) {
      setError("This link is missing its access token. Please use the link from your email exactly as sent.");
      return;
    }
    try {
      const d = await backend.load(token);
      setData(d);
    } catch {
      setError("This link is invalid or has expired. Links are single-use and valid for 7 days.");
    }
  }, [backend, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pending = useMemo(
    () => (data?.scenarios ?? []).filter((s) => !s.answered),
    [data],
  );

  if (error) {
    return (
      <Shell>
        <header className="mb-10">
          <Brand />
        </header>
        <InvalidState message={error} />
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell>
        <header className="mb-10">
          <Brand />
        </header>
        <LoadingState />
      </Shell>
    );
  }

  const handleBegin = async () => {
    if (!token) return;
    setBusy(true);
    try {
      await backend.begin(token);
      const d = await backend.load(token);
      setData(d);
      setCursor(0);
    } catch {
      setError("We couldn't start this session — your link may have expired. Please request a fresh one.");
    } finally {
      setBusy(false);
    }
  };

  const status = data.session.status;
  // Gate 2: an invited-but-not-begun session shows the preview/consent screen.
  // The owner physically cannot answer until they tap Begin (also enforced
  // server-side in ownerRespond's OPEN_FOR_RESPONSES check).
  if (status === "fdc_approved") {
    return (
      <Shell>
        <header className="mb-10">
          <Brand />
        </header>
        <PreviewConsent data={data} onBegin={handleBegin} busy={busy} />
      </Shell>
    );
  }
  // Not yet approved/invited — nothing for the owner to do yet.
  if (status === "draft" || status === "generated") {
    return (
      <Shell>
        <header className="mb-10">
          <Brand />
        </header>
        <NotReadyState name={data.client?.name} />
      </Shell>
    );
  }

  const allDone = pending.length === 0;
  const current = pending[Math.min(cursor, pending.length - 1)];

  const handleSubmit = async (text: string, followUp?: string, voiceRef?: string) => {
    if (!token || !current) return;
    setBusy(true);
    try {
      await backend.respond({
        token,
        scenarioId: current.scenarioId,
        modality: voiceRef ? "voice" : "text",
        text,
        followUpText: followUp,
        voiceRef,
      });
      // reload truth from server (progress + Gate B), then advance
      const d = await backend.load(token);
      setData(d);
      setCursor(0); // pending list shrinks; always show the first remaining
    } catch {
      setError("We couldn’t save that — your link may have expired. Please request a fresh one.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <header className="mb-9 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Brand />
          {data.client?.name && (
            <span className="text-[13px] text-[#9CA0A8]">{data.client.name}</span>
          )}
        </div>
        <ProgressRail answered={data.progress.answered} total={data.progress.total} />
      </header>

      {allDone ? (
        <DoneState data={data} />
      ) : (
        <VignetteCard
          key={current.scenarioId}
          scenario={current}
          index={data.progress.answered}
          total={data.progress.total}
          onSubmit={handleSubmit}
          onTranscribe={(audio) => {
            if (!token) throw new Error("Missing token");
            return backend.transcribe({ token, audio });
          }}
          busy={busy}
        />
      )}

      <footer className="mt-10 text-center text-[11px] tracking-wide text-[#4F535B]">
        Your answers are private to your FDC engagement team.
      </footer>
    </Shell>
  );
}

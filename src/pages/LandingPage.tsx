import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

const NAVY = "#1A1A2E";
const NAVY_LIGHT = "#2A2A42";
const GOLD = "#B8960A";
const GOLD_LIGHT = "#D4AF37";

// Extract a magic-link token whether the owner pastes a full invite URL or just
// the raw token. Returns null if nothing usable is found.
function extractToken(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    const t = u.searchParams.get("token");
    if (t) return t;
  } catch {
    // not a URL — fall through
  }
  const m = v.match(/token=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  // looks like a bare token (base64url.hex) — accept it
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(v)) return v;
  return null;
}

export function LandingPage() {
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    const token = extractToken(value);
    if (!token) {
      setError("That doesn't look like a valid session link. Paste the full link from your FDC invitation.");
      return;
    }
    navigate(`/respond?token=${encodeURIComponent(token)}`);
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Hero — FDC navy */}
      <section
        className="relative flex-1 flex flex-col items-center justify-center px-4 py-20 md:py-28"
        style={{ background: NAVY }}
      >
        <div
          className="absolute inset-0 -z-0 opacity-60"
          style={{
            background: `radial-gradient(ellipse 70% 50% at 50% 0%, ${NAVY_LIGHT} 0%, transparent 70%)`,
          }}
        />
        <div className="relative max-w-2xl mx-auto text-center">
          <p
            className="text-[12px] font-semibold uppercase mb-6"
            style={{ letterSpacing: "2.5px", color: GOLD }}
          >
            A Frank Data Consultants engagement
          </p>

          <h1
            className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.05]"
            style={{ color: "#fff" }}
          >
            Litmus
          </h1>
          <p
            className="mt-5 text-lg md:text-xl leading-relaxed"
            style={{ color: "rgba(255,255,255,0.78)" }}
          >
            A short, guided session that turns your business's own day-to-day
            situations into true-to-life scenarios — so your FDC team can see how
            you actually weigh the decisions that matter.
          </p>
          <p
            className="mt-3 text-sm leading-relaxed"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            It's part of how we work <em>with</em> you during discovery — not a
            product, and nothing to sign up for.
          </p>

          {/* Open your session */}
          <div
            className="mt-10 mx-auto max-w-md rounded-2xl p-5 text-left"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)",
            }}
          >
            <label
              className="block text-sm font-semibold mb-2"
              style={{ color: "#fff" }}
            >
              Open your session
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && open()}
                placeholder="Paste your invitation link"
                className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                style={{
                  background: "rgba(255,255,255,0.92)",
                  color: NAVY,
                }}
              />
              <button
                onClick={open}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
                style={{ background: GOLD, color: "#fff" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = GOLD_LIGHT)
                }
                onMouseLeave={(e) => (e.currentTarget.style.background = GOLD)}
              >
                Open <ArrowRight className="size-4" />
              </button>
            </div>
            {error && (
              <p className="mt-2 text-xs" style={{ color: "#F8B4B4" }}>
                {error}
              </p>
            )}
            <p
              className="mt-3 text-xs leading-relaxed"
              style={{ color: "rgba(255,255,255,0.5)" }}
            >
              Litmus is invitation-only. You'll have received a private link from
              your FDC team — open that to begin. No link yet? It comes by
              invitation through your FDC engagement.
            </p>
          </div>
        </div>
      </section>

      {/* Minimal FDC footer */}
      <footer
        className="px-4 py-8"
        style={{ background: NAVY, borderTop: "1px solid rgba(255,255,255,0.08)" }}
      >
        <div className="max-w-2xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
          <span
            className="text-[11px] font-bold uppercase"
            style={{ letterSpacing: "2.5px", color: GOLD }}
          >
            Frank Data Consultants
          </span>
          <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
            Decision Engineering for high-stakes choices.
          </span>
        </div>
      </footer>
    </div>
  );
}

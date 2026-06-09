// Minimal Anthropic client for Convex actions. Reads the FDC-owned key from the
// Convex deployment env (ANTHROPIC_API_KEY) — NOT Viktor internal infra — per
// the Stage 3 architecture. No key is ever read from source or the front-end.

declare const process: { env: Record<string, string | undefined> };

// Current model ids (verified 200). Generation favours quality -> Sonnet.
export const GEN_MODEL = "claude-sonnet-4-5";

export interface AnthropicResult {
  text: string;
  stopReason: string | null;
  usage: { input_tokens?: number; output_tokens?: number } | null;
}

export async function anthropicMessage(opts: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<AnthropicResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY missing from Convex env — env-wiring not provisioned for this deployment.",
    );
  }
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model ?? GEN_MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    }),
  });
  if (!resp.ok) {
    throw new Error(`Anthropic API ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
  }
  const j = (await resp.json()) as {
    content: { type: string; text?: string }[];
    stop_reason: string | null;
    usage: { input_tokens?: number; output_tokens?: number };
  };
  const text = j.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  return { text, stopReason: j.stop_reason, usage: j.usage ?? null };
}

// Extract the first JSON array/object from a model response (handles ```json fences
// and incidental prose around the payload).
export function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found in model response");
  // Walk to the matching closing bracket.
  const open = candidate[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  throw new Error("Unbalanced JSON in model response");
}

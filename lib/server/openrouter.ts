// SERVER ONLY. Google Gemini models via the OpenRouter gateway, pinned to Google's own
// infrastructure. The key is read from the environment and never leaves the server.

export type ModelFailure = "missing_key" | "rate_limited" | "timeout" | "out_of_credits" | "upstream" | "bad_output";
export type ModelResult<T> =
  | { ok: true; data: T; model: string; costUsd: number | null }
  | { ok: false; reason: ModelFailure };

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TOTAL_BUDGET_MS = 12000;

function models(): string[] {
  const primary = process.env.GEMINI_MODEL || "google/gemini-3.7-flash";
  const fallback = process.env.GEMINI_FALLBACK_MODEL || "google/gemini-3.5-flash-lite";
  // Google models only.
  return [primary, fallback].filter((m, i, a) => m.startsWith("google/") && a.indexOf(m) === i);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function callModel<T>(opts: {
  name: string;
  schema: Record<string, unknown>;
  system: string;
  user: string;
  maxTokens?: number;
  validate: (x: unknown) => T | null;
}): Promise<ModelResult<T>> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { ok: false, reason: "missing_key" };
  const started = Date.now();
  let last: ModelFailure = "upstream";
  for (const model of models()) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const left = TOTAL_BUDGET_MS - (Date.now() - started);
      if (left < 1500) return { ok: false, reason: "timeout" };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), left);
      try {
        const res = await fetch(ENDPOINT, {
          method: "POST",
          signal: ctrl.signal,
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Ship Easy" },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.user }],
            response_format: { type: "json_schema", json_schema: { name: opts.name, strict: true, schema: opts.schema } },
            provider: { only: ["google-vertex", "google-ai-studio"], allow_fallbacks: false, require_parameters: true },
            reasoning: { effort: "low" },
            max_tokens: opts.maxTokens ?? 1500,
            temperature: 0,
          }),
        });
        clearTimeout(timer);
        if (res.status === 402) return { ok: false, reason: "out_of_credits" };
        if (res.status === 429 || res.status >= 500) {
          last = res.status === 429 ? "rate_limited" : "upstream";
          await sleep(300 * 2 ** attempt);
          continue;
        }
        if (!res.ok) { last = "upstream"; break; } // e.g. 404 model gone -> try the fallback model
        const j = await res.json();
        const content = j?.choices?.[0]?.message?.content;
        let parsed: unknown = null;
        try { parsed = typeof content === "string" ? JSON.parse(content) : null; } catch { parsed = null; }
        const data = parsed === null ? null : opts.validate(parsed);
        if (data === null) { last = "bad_output"; break; }
        const cost = j?.usage?.cost_details?.upstream_inference_cost ?? j?.usage?.cost ?? null;
        return { ok: true, data, model: j?.model ?? model, costUsd: typeof cost === "number" ? cost : null };
      } catch (e) {
        clearTimeout(timer);
        last = (e as { name?: string })?.name === "AbortError" ? "timeout" : "upstream";
        if (last === "timeout") return { ok: false, reason: "timeout" };
        await sleep(300 * 2 ** attempt);
      }
    }
  }
  return { ok: false, reason: last };
}

export const FAILURE_TEXT: Record<ModelFailure, string> = {
  missing_key: "The AI service isn't configured, so Ship Easy switched to Local-only mode. Everything still works.",
  rate_limited: "The AI service is busy (rate limited), so Ship Easy switched to Local-only mode. Everything still works.",
  timeout: "The AI service didn't answer in time, so Ship Easy switched to Local-only mode. Everything still works.",
  out_of_credits: "The AI service is unavailable, so Ship Easy switched to Local-only mode. Everything still works.",
  upstream: "The AI service had a problem, so Ship Easy switched to Local-only mode. Everything still works.",
  bad_output: "The AI reply couldn't be used, so Ship Easy switched to Local-only mode. Everything still works.",
};

// POST /api/hs -> AI-suggested HS codes for item descriptions, each checked against the UK Trade Tariff.
// Suggestions are never applied here; the client shows them as "Possible" with a verify link.
import { z } from "zod";
import { HS_SCHEMA, HS_SYSTEM, HsOut, tariffSearchUrl, tariffUrl, type HsSuggestion } from "@/lib/hs";
import { clientIp, json, rateLimited, readJson } from "@/lib/server/guard";
import { callModel, FAILURE_TEXT } from "@/lib/server/openrouter";
import { checkHs } from "@/lib/server/tariff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

const Body = z.object({ descriptions: z.array(z.string().min(1).max(200)).min(1).max(40) });

export async function POST(req: Request) {
  try {
    if (rateLimited(clientIp(req))) return json({ ok: false, reason: "rate_limited", message: FAILURE_TEXT.rate_limited });
    const r = await readJson(req);
    if (!r.ok) return json({ ok: false, reason: "bad_request", message: r.error }, r.status);
    const parsed = Body.safeParse(r.body);
    if (!parsed.success) return json({ ok: false, reason: "bad_request", message: "Malformed request." }, 400);
    const descriptions = parsed.data.descriptions;
    const out = await callModel({
      name: "hs_suggestions",
      schema: HS_SCHEMA as unknown as Record<string, unknown>,
      system: HS_SYSTEM,
      user: descriptions.map((d, i) => `${i}: ${d}`).join("\n"),
      maxTokens: 2000,
      validate: (x) => { const v = HsOut.safeParse(x); return v.success ? v.data : null; },
    });
    if (!out.ok) return json({ ok: false, reason: out.reason, message: FAILURE_TEXT[out.reason] });
    const suggestions: HsSuggestion[] = await Promise.all(descriptions.map(async (description, i) => {
      const code = (out.data.results.find((x) => x.index === i)?.code ?? "").replace(/\D/g, "").slice(0, 6);
      if (code.length !== 6) return { description, code: null, official: null, url: tariffSearchUrl, note: "The description is too vague to suggest a code. Search the tariff yourself." };
      const t = await checkHs(code);
      // a code the tariff doesn't recognise is never shown to the seller
      if (!t.ok) return { description, code: null, official: null, url: tariffSearchUrl, note: "I couldn't find a matching code in the official tariff. Search it yourself." };
      return { description, code, official: t.official, url: tariffUrl(code) };
    }));
    return json({ ok: true, suggestions, model: out.model, costUsd: out.costUsd });
  } catch {
    return json({ ok: false, reason: "upstream", message: FAILURE_TEXT.upstream });
  }
}

// POST /api/explain -> ONE batched call per upload: plain-English narrative per booking,
// written only from the computed findings (item descriptions + findings; no file is sent).
import { z } from "zod";
import { EXPLAIN_SCHEMA, EXPLAIN_SYSTEM, ExplainOut } from "@/lib/modelContract";
import { clientIp, json, rateLimited, readJson } from "@/lib/server/guard";
import { callModel, FAILURE_TEXT } from "@/lib/server/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

const Body = z.object({
  bookings: z.array(z.object({
    ref: z.string().max(60),
    verdict: z.string().max(20),
    items: z.array(z.string().max(200)).max(30),
    findings: z.array(z.object({ rule: z.string().max(8), severity: z.string().max(20), problem: z.string().max(400), fix: z.string().max(500) })).max(12),
    carrier: z.string().max(400),
  })).min(1).max(60),
});

export async function POST(req: Request) {
  try {
    if (rateLimited(clientIp(req))) return json({ ok: false, reason: "rate_limited", message: FAILURE_TEXT.rate_limited });
    const r = await readJson(req);
    if (!r.ok) return json({ ok: false, reason: "bad_request", message: r.error }, r.status);
    const parsed = Body.safeParse(r.body);
    if (!parsed.success) return json({ ok: false, reason: "bad_request", message: "Malformed request." }, 400);
    const out = await callModel({
      name: "explanations",
      schema: EXPLAIN_SCHEMA as unknown as Record<string, unknown>,
      system: EXPLAIN_SYSTEM,
      user: JSON.stringify(parsed.data.bookings),
      maxTokens: 6000,
      validate: (x) => { const v = ExplainOut.safeParse(x); return v.success ? v.data : null; },
    });
    if (!out.ok) return json({ ok: false, reason: out.reason, message: FAILURE_TEXT[out.reason] });
    return json({ ok: true, narratives: out.data.narratives, model: out.model, costUsd: out.costUsd });
  } catch {
    return json({ ok: false, reason: "upstream", message: FAILURE_TEXT.upstream });
  }
}

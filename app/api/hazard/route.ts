// POST /api/hazard -> R-06 implied-hazard classification for item descriptions only.
// The model may ADD an "implied" flag; it can never downgrade the local keyword list.
import { z } from "zod";
import { HAZARD_SCHEMA, HAZARD_SYSTEM, HazardOut } from "@/lib/modelContract";
import { clientIp, json, rateLimited, readJson } from "@/lib/server/guard";
import { callModel, FAILURE_TEXT } from "@/lib/server/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const Body = z.object({ descriptions: z.array(z.string().max(200)).min(1).max(200) });

export async function POST(req: Request) {
  try {
    if (rateLimited(clientIp(req))) return json({ ok: false, reason: "rate_limited", message: FAILURE_TEXT.rate_limited });
    const r = await readJson(req);
    if (!r.ok) return json({ ok: false, reason: "bad_request", message: r.error }, r.status);
    const parsed = Body.safeParse(r.body);
    if (!parsed.success) return json({ ok: false, reason: "bad_request", message: "Malformed request." }, 400);
    const list = parsed.data.descriptions.map((d, i) => `${i}: ${d}`).join("\n");
    const out = await callModel({
      name: "hazard_classification",
      schema: HAZARD_SCHEMA as unknown as Record<string, unknown>,
      system: HAZARD_SYSTEM,
      user: list,
      maxTokens: 2000,
      validate: (x) => { const v = HazardOut.safeParse(x); return v.success ? v.data : null; },
    });
    if (!out.ok) return json({ ok: false, reason: out.reason, message: FAILURE_TEXT[out.reason] });
    return json({ ok: true, results: out.data.results, model: out.model, costUsd: out.costUsd });
  } catch {
    return json({ ok: false, reason: "upstream", message: FAILURE_TEXT.upstream });
  }
}

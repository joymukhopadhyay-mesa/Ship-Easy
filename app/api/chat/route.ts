// POST /api/chat -> a PATCH of seller-supplied fields (never the booking). The client
// sanitises it again (allow-list + source check) before merging. Never throws to the user.
import { z } from "zod";
import { chatOutToPatch, chatSystemPrompt, chatUserPrompt, CHAT_SCHEMA, ChatOut } from "@/lib/modelContract";
import { clientIp, json, MAX_MESSAGE_CHARS, rateLimited, readJson } from "@/lib/server/guard";
import { callModel, FAILURE_TEXT } from "@/lib/server/openrouter";
import { isIsoDate } from "@/lib/dates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const Body = z.object({
  message: z.string().min(1).max(MAX_MESSAGE_CHARS),
  today: z.string().refine(isIsoDate),
  context: z.object({
    expecting: z.array(z.object({ field: z.string().max(40), sku: z.string().max(60).nullable().optional(), rowId: z.string().max(20).optional() })).max(10),
    items: z.array(z.object({ sku: z.string().max(60), description: z.string().max(200) })).max(50),
    pendingChoice: z.boolean(),
  }),
});

export async function POST(req: Request) {
  try {
    if (rateLimited(clientIp(req))) return json({ ok: false, reason: "rate_limited", message: FAILURE_TEXT.rate_limited });
    const r = await readJson(req);
    if (!r.ok) return json({ ok: false, reason: "bad_request", message: r.error }, r.status);
    const parsed = Body.safeParse(r.body);
    if (!parsed.success) return json({ ok: false, reason: "bad_request", message: "That message couldn't be processed (too long or malformed)." }, 400);
    const { message, today, context } = parsed.data;
    const out = await callModel({
      name: "booking_patch",
      schema: CHAT_SCHEMA as unknown as Record<string, unknown>,
      system: chatSystemPrompt(today),
      user: chatUserPrompt(message, { today, expecting: context.expecting.map((e) => ({ field: e.field, sku: e.sku ?? undefined })), items: context.items, pendingChoice: context.pendingChoice }),
      maxTokens: 1500,
      validate: (x) => { const v = ChatOut.safeParse(x); return v.success ? v.data : null; },
    });
    if (!out.ok) return json({ ok: false, reason: out.reason, message: FAILURE_TEXT[out.reason] });
    return json({ ok: true, patch: chatOutToPatch(out.data), model: out.model, costUsd: out.costUsd });
  } catch {
    return json({ ok: false, reason: "upstream", message: FAILURE_TEXT.upstream });
  }
}

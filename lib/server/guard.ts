// SERVER ONLY. Basic abuse protection for the model routes: request size cap and a
// simple per-IP in-memory rate limit. Errors are always friendly JSON, never a stack trace.

export const MAX_BODY_BYTES = 32 * 1024;
export const MAX_MESSAGE_CHARS = 1000;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 40;

const hits = new Map<string, number[]>();

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

export function rateLimited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return recent.length > MAX_PER_WINDOW;
}

export async function readJson(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; status: number; error: string }> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY_BYTES) return { ok: false, status: 413, error: "Request too large." };
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return { ok: false, status: 413, error: "Request too large." };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "Request was not valid JSON." };
  }
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

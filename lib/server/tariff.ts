// SERVER ONLY. Checks a suggested HS code against the UK government's public Trade Tariff
// (no key or login). Confirms the 6-digit code really exists (some commodity starts with it)
// and returns the official wording. Never throws: any failure -> null (suggestion dropped).
import { TARIFF_HOME } from "../hs";

const cache = new Map<string, { ok: boolean; official: string | null; at: number }>();
const TTL = 6 * 3600_000;

interface TariffInclude { type: string; attributes?: { goods_nomenclature_item_id?: string; description?: string; formatted_description?: string; description_plain?: string } }

export async function checkHs(code: string): Promise<{ ok: boolean; official: string | null }> {
  if (!/^\d{6}$/.test(code)) return { ok: false, official: null };
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL) return hit;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(`${TARIFF_HOME}/api/v2/headings/${code.slice(0, 4)}`, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, official: null };
    const j = (await res.json()) as { data?: { attributes?: { description_plain?: string; description?: string } }; included?: TariffInclude[] };
    const commodities = (j.included ?? []).filter((x) => x.type === "commodity" && x.attributes?.goods_nomenclature_item_id?.startsWith(code));
    const heading = j.data?.attributes?.description_plain ?? j.data?.attributes?.description ?? null;
    const sub = commodities.map((c) => c.attributes?.description_plain ?? c.attributes?.description).find((d) => d && d.length > 3) ?? null;
    const out = { ok: commodities.length > 0, official: commodities.length ? [heading, sub].filter(Boolean).join(" › ").replace(/<[^>]+>/g, "").slice(0, 220) : null, at: Date.now() };
    if (cache.size > 500) cache.clear();
    cache.set(code, out);
    return out;
  } catch {
    return { ok: false, official: null };
  }
}

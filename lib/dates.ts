// Pure calendar arithmetic on ISO dates (YYYY-MM-DD). No clock reads except
// londonToday(now), which callers (UI / API) use to produce the injected "today".
import { TIMEZONE } from "./config";

const toUTC = (iso: string) => new Date(iso + "T00:00:00Z");

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = toUTC(s);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 0 = Sunday ... 6 = Saturday */
export function dayOfWeek(iso: string): number {
  return toUTC(iso).getUTCDay();
}

export function addDays(iso: string, n: number): string {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Saturday/Sunday roll forward to the next Monday; weekdays unchanged. */
export function nextWeekday(iso: string): string {
  const d = dayOfWeek(iso);
  if (d === 6) return addDays(iso, 2);
  if (d === 0) return addDays(iso, 1);
  return iso;
}

/** Collection = ready date if Mon-Fri, otherwise the next Monday. */
export function collectionDate(ready: string): string {
  return nextWeekday(ready);
}

/** ETA = collection + transit calendar days, rolled to Monday if it lands on a weekend. */
export function etaDate(collection: string, transitDays: number): string {
  return nextWeekday(addDays(collection, transitDays));
}

export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86400000);
}

/** DD-MM-YYYY -> ISO, or null if not a real date. Accepts / and . separators. */
export function parseDDMMYYYY(raw: string): string | null {
  const m = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\s*$/.exec(raw);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

export function toDDMMYYYY(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu 5 Nov 2026" */
export function prettyDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${DOW[dayOfWeek(iso)]} ${d} ${MON[m - 1]} ${y}`;
}

/** Today's date in Europe/London for a given instant. Only the app/API call this. */
export function londonToday(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "25-10-2026 14:03" in Europe/London for a given instant. */
export function londonStamp(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}:${get("minute")}`;
}

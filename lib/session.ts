// A booking being worked on (from chat or from a file): applies seller edits, re-runs
// validation, and appends a timestamped change-log entry. Pure: "stamp" is injected.
import { diffLines, type ChangeLogEntry, type FieldChange } from "./changelog";
import { cityCountry, CURRENCY, ORIGIN_COUNTRY } from "./config";
import { round2 } from "./format";
import type { Booking, CarrierId, Env, Item } from "./types";
import { validateBooking } from "./validate";
import type { BookingResult } from "./types";

export interface Session {
  mode: "chat" | "file";
  booking: Booking;
  /** Chat mode: booking-level numbers the seller typed in themselves (then not recomputed). */
  overrides: { cartons: boolean; declaredValue: boolean };
  /** Chat mode: item cartons the seller stated (not computed from quantity ÷ units per carton). */
  sellerCartons: string[];
  log: ChangeLogEntry[];
  result: BookingResult;
}

export type EditPath =
  | "pallets" | "grossWeight" | "cartons" | "declaredValue" | "destinationCity" | "originCity" | "destinationType"
  | "readyDate" | "priority" | "appointmentBooked" | "chosenCarrier" | "sellerName"
  | "item.quantity" | "item.unitPrice" | "item.unitsPerCarton" | "item.cartons" | "item.unitWeight" | "item.hsCode"
  | "item.countryOfOrigin" | "item.description" | "item.hazardConfirmedAt";

export interface Edit {
  path: EditPath;
  rowId?: string;
  value: string | number | boolean | null;
}

export const BOOKING_LABEL: Record<string, string> = {
  pallets: "Pallets", grossWeight: "Gross weight (kg)", cartons: "Cartons", declaredValue: "Declared value (GBP)",
  destinationCity: "Destination", originCity: "Origin", destinationType: "Destination type", readyDate: "Ready date",
  priority: "Priority", appointmentBooked: "Delivery appointment", chosenCarrier: "Carrier choice", sellerName: "Seller",
};
export const ITEM_LABEL: Record<string, string> = {
  quantity: "quantity", unitPrice: "unit price", unitsPerCarton: "units per carton", cartons: "cartons", unitWeight: "unit weight (kg)",
  hsCode: "HS code", countryOfOrigin: "country of origin", description: "description", hazardConfirmedAt: "hazard declaration",
};

const clone = (b: Booking): Booking => ({ ...b, items: b.items.map((i) => ({ ...i })), quarantined: [...(b.quarantined ?? [])] });

/** Chat mode derived values: inferred countries/currency and computed cartons / declared value. */
export function recompute(b: Booking, s: Pick<Session, "overrides" | "sellerCartons" | "mode">): Booking {
  if (s.mode !== "chat") return b;
  const out = clone(b);
  out.originCountry = ORIGIN_COUNTRY;
  out.currency = CURRENCY;
  out.destinationCountry = cityCountry(out.destinationCity);
  for (const it of out.items) {
    if (s.sellerCartons.includes(it.rowId)) continue;
    // item cartons are computed ONLY when quantity divides evenly by units per carton
    it.cartons = it.quantity != null && it.unitsPerCarton && it.quantity % it.unitsPerCarton === 0 ? it.quantity / it.unitsPerCarton : null;
  }
  const all = (f: (i: Item) => boolean) => out.items.length > 0 && out.items.every(f);
  if (!s.overrides.cartons) out.cartons = all((i) => i.cartons != null) ? out.items.reduce((t, i) => t + i.cartons!, 0) : null;
  if (!s.overrides.declaredValue) out.declaredValue = all((i) => i.quantity != null && i.unitPrice != null) ? round2(out.items.reduce((t, i) => t + i.quantity! * i.unitPrice!, 0)) : null;
  return out;
}

export function newSession(mode: Session["mode"], booking: Booking, env: Env): Session {
  const base = { mode, overrides: { cartons: false, declaredValue: false }, sellerCartons: [] as string[] };
  const b = recompute(booking, base);
  return { ...base, booking: b, log: [], result: validateBooking(b, env) };
}

function setField(b: Booking, e: Edit): FieldChange | null {
  if (e.path.startsWith("item.")) {
    const key = e.path.slice(5) as keyof Item;
    const it = b.items.find((i) => i.rowId === e.rowId);
    if (!it) return null;
    const from = (it[key] ?? null) as FieldChange["from"];
    if (from === e.value) return null;
    (it as unknown as Record<string, unknown>)[key] = e.value;
    if (key === "hazardConfirmedAt") return { label: `${it.sku || "Item"} hazard declaration`, from: from ?? "none", to: e.value ? `Confirmed by seller, ${e.value} (Europe/London)` : "withdrawn" };
    if (key === "quantity" || key === "unitPrice" || key === "unitsPerCarton" || key === "cartons" || key === "unitWeight") it.quarantined = (it.quarantined ?? []).filter((q) => q.field !== ITEM_LABEL[key]);
    return { label: `${it.sku || "Item"} ${ITEM_LABEL[key]}`, from, to: e.value };
  }
  const key = e.path as keyof Booking;
  const from = (b[key] ?? null) as FieldChange["from"];
  if (from === e.value) return null;
  (b as unknown as Record<string, unknown>)[key] = key === "chosenCarrier" ? ((e.value as CarrierId | null) ?? null) : e.value;
  if (key === "destinationCity") b.destinationCountry = cityCountry(String(e.value ?? "")) ?? b.destinationCountry;
  const qLabel: Record<string, string> = { pallets: "Pallets", grossWeight: "Total gross weight (kg)", cartons: "Cartons", declaredValue: "Total declared value", readyDate: "Ready to ship date" };
  if (qLabel[key]) b.quarantined = (b.quarantined ?? []).filter((q) => q.field !== qLabel[key]);
  return { label: BOOKING_LABEL[key] ?? key, from, to: e.value };
}

/**
 * Applies edits, re-validates and (when `log` is true) appends a change-log entry built
 * from exactly what changed. Seller overrides always win; the rules then check them.
 */
export function applyEdits(s: Session, edits: Edit[], source: ChangeLogEntry["source"], env: Env, stamp: string, log = true): { session: Session; changes: FieldChange[] } {
  const b = clone(s.booking);
  const changes: FieldChange[] = [];
  const overrides = { ...s.overrides };
  const sellerCartons = [...s.sellerCartons];
  for (const e of edits) {
    const c = setField(b, e);
    if (!c) continue;
    changes.push(c);
    if (s.mode === "chat") {
      if (e.path === "cartons") overrides.cartons = true;
      if (e.path === "declaredValue") overrides.declaredValue = true;
      if (e.path === "item.cartons" && e.rowId && !sellerCartons.includes(e.rowId)) sellerCartons.push(e.rowId);
    }
  }
  const next = recompute(b, { mode: s.mode, overrides, sellerCartons });
  // computed fields that changed as a consequence are shown too (e.g. declared value after a quantity change)
  if (s.mode === "chat") {
    for (const k of ["cartons", "declaredValue"] as const) {
      if (next[k] !== s.booking[k] && !changes.some((c) => c.label === BOOKING_LABEL[k])) changes.push({ label: `${BOOKING_LABEL[k]} (calculated)`, from: s.booking[k], to: next[k] });
    }
    for (const it of next.items) {
      const before = s.booking.items.find((i) => i.rowId === it.rowId);
      if (before && before.cartons !== it.cartons && !changes.some((c) => c.label === `${it.sku} cartons`)) changes.push({ label: `${it.sku} cartons (calculated)`, from: before.cartons, to: it.cartons });
    }
  }
  const result = validateBooking(next, env);
  const entry: ChangeLogEntry | null = log && changes.length
    ? { at: stamp, source, lines: diffLines(s.result, result, changes), verdictFrom: s.result.verdict, verdictTo: result.verdict }
    : null;
  return { session: { ...s, booking: next, overrides, sellerCartons, result, log: entry ? [...s.log, entry] : s.log }, changes };
}

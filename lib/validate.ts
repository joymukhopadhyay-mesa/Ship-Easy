// Data completeness gate (never emits a Red) -> rules -> verdict -> repairs.
import { CURRENCY, ITEM_ORIGIN_COUNTRIES, ORIGIN_CITIES, ORIGIN_COUNTRY } from "./config";
import { buildContext } from "./context";
import { plural } from "./format";
import { computeRepairs } from "./repair";
import { runRules } from "./rulebook";
import type { Booking, BookingResult, Env, GateNote, RuleResult, Verdict } from "./types";

const ITEM_NUMBERS: [keyof Booking["items"][number], string, string][] = [
  ["quantity", "quantity", "R-02, R-03, R-07"],
  ["unitPrice", "unit price", "R-02"],
  ["unitsPerCarton", "units per carton", "R-03"],
  ["cartons", "cartons", "R-03, R-04"],
  ["unitWeight", "unit weight", "R-07"],
];

export function dataGate(b: Booking, lane: string | null): GateNote[] {
  const g: GateNote[] = [];
  if (b.duplicateOf) g.push({ code: "D-04", message: `Booking ID ${b.bookingId} appears more than once. Both copies are shown; items with this ID can't be attributed to one of them.` });
  if (b.items.length === 0) g.push({ code: "D-01", message: "This booking has no item rows, so R-02, R-03, R-04 and R-07 could not be checked." });
  for (const q of b.quarantined ?? []) g.push({ code: "D-06", field: q.field, message: `${q.field}: "${q.raw}" ${q.reason}; value quarantined.` });
  const palletsQuarantined = (b.quarantined ?? []).some((q) => q.field === "Pallets");
  if (!palletsQuarantined && (b.pallets == null || b.pallets === 0)) g.push({ code: "D-05", field: "Pallets", message: `Pallets is ${b.pallets === 0 ? "0" : "blank"}, so weight per pallet (R-05) cannot be computed.` });
  const missing: string[] = [];
  const q = new Set((b.quarantined ?? []).map((x) => x.field));
  if (b.cartons == null && !q.has("Cartons")) missing.push("cartons (R-04)");
  if (b.declaredValue == null && !q.has("Total declared value")) missing.push("declared value (R-02)");
  if (b.grossWeight == null && !q.has("Total gross weight (kg)")) missing.push("gross weight (R-05, R-07)");
  if (!b.readyDate && !q.has("Ready to ship date")) missing.push("ready date (R-10)");
  if (!b.destinationType) missing.push("destination type (R-08)");
  if (b.destinationType === "Warehouse" && b.appointmentBooked == null) missing.push("delivery appointment answer (R-08)");
  if (!lane) missing.push("a destination on the rate card (R-05)");
  if (missing.length) g.push({ code: "D-02", message: `Booking is missing ${missing.join(", ")}.` });
  for (const it of b.items) {
    for (const qq of it.quarantined ?? []) g.push({ code: "D-06", rowId: it.rowId, field: qq.field, message: `${it.sku || "Item"} ${qq.field}: "${qq.raw}" ${qq.reason}; value quarantined and the item excluded from the sums it feeds.` });
    const iq = new Set((it.quarantined ?? []).map((x) => x.field));
    const miss = ITEM_NUMBERS.filter(([k, label]) => it[k] == null && !iq.has(label));
    if (miss.length) g.push({ code: "D-02", rowId: it.rowId, message: `${it.sku || "Item"} is missing ${miss.map((m) => m[1]).join(", ")}; it is excluded from the sums for ${[...new Set(miss.flatMap((m) => m[2].split(", ")))].sort().join(", ")}, which are marked not checked.` });
  }
  return g;
}

export function verdictOf(rules: RuleResult[], gate: GateNote[]): Verdict {
  if (rules.some((r) => r.severity === "Red" && r.status === "fail")) return "BLOCKED";
  if (gate.some((n) => n.code !== "D-03") || rules.some((r) => r.status === "not_checked" || r.status === "cannot_compute")) return "INCOMPLETE";
  if (rules.some((r) => r.severity === "Amber" && r.status === "fail")) return "SHIP WITH CARE";
  return "CLEAR TO SHIP";
}

/** Observations that are NOT rules and never change the verdict. */
function fyiNotes(b: Booking, priorityAssumed: boolean): string[] {
  const f: string[] = [];
  if (priorityAssumed) f.push("Seller priority was blank, so the carrier is ranked as Balanced.");
  if (b.originCountry && b.originCountry !== ORIGIN_COUNTRY) f.push(`Origin country "${b.originCountry}" is not the United Kingdom; the rate card only covers UK origins.`);
  if (b.originCity && !(ORIGIN_CITIES as readonly string[]).includes(b.originCity)) f.push(`Origin city "${b.originCity}" is not one of the listed UK collection cities.`);
  if (b.currency && b.currency.toUpperCase() !== CURRENCY) f.push(`Currency "${b.currency}" is not GBP; all values are treated as GBP.`);
  for (const it of b.items) {
    if (it.countryOfOrigin && !(ITEM_ORIGIN_COUNTRIES as readonly string[]).includes(it.countryOfOrigin)) f.push(`${it.sku}: country of origin "${it.countryOfOrigin}" is outside the template's allowed list.`);
  }
  const lines = new Map<string, number>();
  for (const it of b.items) lines.set(it.sku, (lines.get(it.sku) ?? 0) + 1);
  for (const [sku, n] of lines) if (n > 1 && sku) f.push(`${sku} appears on ${plural(n, "line")} (allowed, e.g. a part carton booked separately).`);
  return f;
}

export function validateBooking(booking: Booking, env: Env): BookingResult {
  const ctx = buildContext(booking, env);
  const gate = dataGate(booking, ctx.carrier.lane);
  const rules = runRules(ctx);
  return {
    booking,
    gate,
    rules,
    verdict: verdictOf(rules, gate),
    carrier: ctx.carrier,
    repairs: computeRepairs(booking, env, rules, ctx),
    fyi: fyiNotes(booking, ctx.carrier.priorityAssumed),
    hazards: ctx.hazards,
  };
}

// THE ONLY PLACE WITH RULE LOGIC. Ten rules from template Sheet 4 as data objects
// { id, severity, text, check(ctx) }. Never add rules or severities here; extra
// observations belong in the "FYI, not a rule" list, which never changes the verdict.
import rulebookData from "@/data/rulebook.json";
import { DECLARED_VALUE_TOLERANCE, HS_MIN_DIGITS, TRADE_TARIFF_URL } from "./config";
import type { RuleCtx } from "./context";
import { prettyDate } from "./dates";
import { fmtNum, gbp, kg, plural } from "./format";
import type { RuleId, RuleResult, RuleStatus, Severity } from "./types";

export interface RuleCheck {
  status: RuleStatus;
  message: string;
  numbers?: string[];
  itemRowIds?: string[];
  state?: string;
  caveat?: string;
}

export interface Rule {
  id: RuleId;
  severity: Severity;
  text: string;
  check: (ctx: RuleCtx) => RuleCheck;
}

const sheet = Object.fromEntries(rulebookData.rules.map((r) => [r.id, r])) as unknown as Record<RuleId, { text: string; severity: Severity }>;
const meta = (id: RuleId) => ({ id, severity: sheet[id].severity, text: sheet[id].text });

const notChecked = (why: string): RuleCheck => ({ status: "not_checked", message: `Not checked: ${why}.` });
const label = (ctx: RuleCtx, rowId: string) => {
  const it = ctx.items.find((i) => i.rowId === rowId);
  return it ? `${it.sku || "item"}${it.description ? ` (${it.description})` : ""}` : rowId;
};

/** Digits of an HS code read as text: strip a trailing ".0", dots and spaces. null if it holds anything else. */
export function hsDigits(raw: string | null): string | null {
  if (raw == null) return "";
  const t = String(raw).trim().replace(/\.0$/, "").replace(/[.\s]/g, "");
  return /^\d*$/.test(t) ? t : null;
}

/** R-02 identity: |declared - sum| <= 1% of the computed sum (inclusive). */
export function withinTolerance(declared: number, sum: number): boolean {
  return Math.abs(declared - sum) <= DECLARED_VALUE_TOLERANCE * sum + 1e-9;
}

export const RULES: Rule[] = [
  {
    ...meta("R-01"),
    check(ctx) {
      if (ctx.noItems) return notChecked("the booking has no items");
      const bad: string[] = [];
      const nums: string[] = [];
      let caveat: string | undefined;
      const waiting = ctx.items.filter((i) => !i.hsCode && ctx.pendingFields.has(`hsCode@${i.rowId}`));
      for (const it of ctx.items) {
        if (waiting.includes(it)) continue;
        const d = hsDigits(it.hsCode);
        if (d === null || d.length < HS_MIN_DIGITS) {
          bad.push(it.rowId);
          if (!it.hsCode) nums.push(`${it.sku}: HS code blank`);
          else nums.push(`${it.sku}: "${it.hsCode}" has ${d === null ? "non-digit characters" : plural(d.length, "digit")}`);
          if (d !== null && d.length === HS_MIN_DIGITS - 1) {
            caveat = `A 5-digit code may be a lost leading zero (spreadsheets drop it). Confirm the code at ${TRADE_TARIFF_URL}.`;
          }
        }
      }
      if (!bad.length && waiting.length) return notChecked("the HS code hasn't been asked for yet");
      if (!bad.length) return { status: "pass", message: "Every item has an HS code of at least 6 digits." };
      return {
        status: "fail",
        message: `${plural(bad.length, "item")} without a valid HS code of at least ${HS_MIN_DIGITS} digits: ${bad.map((r) => label(ctx, r)).join("; ")}.`,
        numbers: nums,
        itemRowIds: bad,
        caveat,
      };
    },
  },
  {
    ...meta("R-02"),
    check(ctx) {
      if (ctx.noItems) return notChecked("the booking has no items");
      const dv = ctx.booking.declaredValue;
      if (dv == null) return notChecked("the declared value is missing or unreadable");
      if (ctx.excluded.value.length) return notChecked(`${plural(ctx.excluded.value.length, "item")} missing quantity or unit price`);
      const sum = ctx.sums.value;
      const diff = dv - sum;
      const pct = sum > 0 ? (Math.abs(diff) / sum) * 100 : dv === 0 ? 0 : Infinity;
      const numbers = [
        `Sum of quantity × unit price = ${ctx.usable.value.map((i) => `${fmtNum(i.quantity)} × ${gbp(i.unitPrice)}`).join(" + ")} = ${gbp(sum)}`,
        `Declared = ${gbp(dv)} (difference ${gbp(Math.abs(diff))}, ${Number.isFinite(pct) ? fmtNum(pct, 2) + "%" : "n/a"}; tolerance 1% of ${gbp(sum)} = ${gbp(sum * DECLARED_VALUE_TOLERANCE)})`,
      ];
      if (withinTolerance(dv, sum)) return { status: "pass", message: "Declared value matches the items within 1%.", numbers };
      return { status: "fail", message: `Declared value ${gbp(dv)} does not match the items' total ${gbp(sum)} (off by ${Number.isFinite(pct) ? fmtNum(pct, 2) + "%" : "100%"}, limit 1%).`, numbers };
    },
  },
  {
    ...meta("R-03"),
    check(ctx) {
      if (ctx.noItems) return notChecked("the booking has no items");
      const bad = ctx.usable.cartonMaths.filter((i) => i.unitsPerCarton! * i.cartons! !== i.quantity!);
      const numbers = bad.map((i) => `${i.sku}: ${fmtNum(i.unitsPerCarton)} per carton × ${plural(i.cartons!, "carton")} = ${fmtNum(i.unitsPerCarton! * i.cartons!)}, but quantity is ${fmtNum(i.quantity)}`);
      if (bad.length) return { status: "fail", message: `Carton maths does not add up for ${bad.map((i) => label(ctx, i.rowId)).join("; ")}.`, numbers, itemRowIds: bad.map((i) => i.rowId) };
      if (ctx.excluded.cartonMaths.length) return notChecked(`${plural(ctx.excluded.cartonMaths.length, "item")} missing quantity, units per carton or cartons`);
      return { status: "pass", message: "Units per carton × cartons equals quantity for every item." };
    },
  },
  {
    ...meta("R-04"),
    check(ctx) {
      if (ctx.noItems) return notChecked("the booking has no items");
      const bc = ctx.booking.cartons;
      if (bc == null) return notChecked("the booking's carton count is missing or unreadable");
      if (ctx.excluded.cartons.length) return notChecked(`${plural(ctx.excluded.cartons.length, "item")} missing a carton count`);
      const sum = ctx.sums.cartons;
      const numbers = [`Sum of item cartons = ${ctx.usable.cartons.map((i) => fmtNum(i.cartons)).join(" + ")} = ${fmtNum(sum)}`, `Booking says ${fmtNum(bc)}`];
      if (sum === bc) return { status: "pass", message: "Booking cartons equal the sum of item cartons.", numbers };
      return { status: "fail", message: `Booking says ${plural(bc, "carton")} but the items add up to ${fmtNum(sum)}.`, numbers };
    },
  },
  {
    ...meta("R-05"),
    check(ctx) {
      const c = ctx.carrier;
      const b = ctx.booking;
      if (c.r05 === "cannot_compute") {
        const why = c.lane === null ? "the destination is not on the rate card" : !(b.pallets && b.pallets > 0) ? "pallets is zero or blank" : "the gross weight is missing";
        return { status: "cannot_compute", message: `Cannot compute weight per pallet: ${why}.`, state: "cannot_compute" };
      }
      const per = c.kgPerPallet!;
      const opt = (id: string | null) => c.options.find((o) => o.id === id);
      const base = `${kg(b.grossWeight)} ÷ ${plural(b.pallets!, "pallet")} = ${kg(per)} per pallet`;
      const caps = c.options.map((o) => `${o.name} cap ${fmtNum(o.maxKgPerPallet)} kg${o.feasible ? " ✓" : " ✗"}`).join(", ");
      if (c.r05 === "no_carrier_fits") {
        return { status: "fail", state: "no_carrier_fits", message: `${kg(per)} per pallet is above every carrier's limit on this lane (highest is ${fmtNum(Math.max(...c.options.map((o) => o.maxKgPerPallet)))} kg), so no carrier will take it.`, numbers: [base, caps] };
      }
      if (c.r05 === "seller_override") {
        const o = opt(c.chosen)!;
        return { status: "fail", state: "seller_override", message: `You picked ${o.name}, whose limit is ${fmtNum(o.maxKgPerPallet)} kg per pallet; this booking is ${kg(per)} per pallet.`, numbers: [base, caps] };
      }
      const o = opt(c.chosen)!;
      return { status: "pass", state: "pass", message: `${kg(per)} per pallet is within ${o.name}'s ${fmtNum(o.maxKgPerPallet)} kg limit.`, numbers: [base, caps] };
    },
  },
  {
    ...meta("R-06"),
    check(ctx) {
      if (ctx.noItems) return notChecked("the booking has no items");
      const explicit = ctx.items.filter((i) => ctx.hazards[i.rowId]?.kind === "explicit");
      const implied = ctx.items.filter((i) => ctx.hazards[i.rowId]?.kind === "implied");
      const pending = implied.filter((i) => !i.hazardConfirmedAt);
      const confirmed = implied.filter((i) => i.hazardConfirmedAt);
      const numbers = [
        ...explicit.map((i) => `${i.sku}: description names a ${ctx.hazards[i.rowId].matched}`),
        ...pending.map((i) => `${i.sku}: ${ctx.hazards[i.rowId].matched} — needs seller confirmation`),
        ...confirmed.map((i) => `${i.sku}: Confirmed by seller, ${i.hazardConfirmedAt} (Europe/London)`),
      ];
      if (explicit.length) {
        return { status: "fail", state: "explicit", message: `Blocked: ${explicit.map((i) => label(ctx, i.rowId)).join("; ")} is a restricted dangerous good (lithium batteries, aerosols and flammable liquids are not allowed).`, numbers, itemRowIds: [...explicit, ...pending].map((i) => i.rowId) };
      }
      if (pending.length) {
        return { status: "fail", state: "implied", message: `Blocked pending seller confirmation: ${pending.map((i) => label(ctx, i.rowId)).join("; ")} usually contains a lithium battery, aerosol or flammable liquid.`, numbers, itemRowIds: pending.map((i) => i.rowId) };
      }
      return { status: "pass", message: confirmed.length ? "No restricted goods (seller confirmed the flagged items)." : "No lithium batteries, aerosols or flammable liquids found.", numbers: numbers.length ? numbers : undefined };
    },
  },
  {
    ...meta("R-07"),
    check(ctx) {
      if (ctx.noItems) return notChecked("the booking has no items");
      const gw = ctx.booking.grossWeight;
      if (gw == null) return notChecked("the gross weight is missing or unreadable");
      if (ctx.excluded.weight.length) return notChecked(`${plural(ctx.excluded.weight.length, "item")} missing quantity or unit weight`);
      const goods = ctx.sums.goodsWeight;
      const numbers = [`Goods alone = ${ctx.usable.weight.map((i) => `${fmtNum(i.quantity)} × ${fmtNum(i.unitWeight, 3)} kg`).join(" + ")} = ${kg(goods)}`, `Declared gross weight = ${kg(gw)}`];
      if (gw + 1e-9 >= goods) return { status: "pass", message: "Gross weight covers at least the goods themselves.", numbers };
      return { status: "fail", message: `Gross weight ${kg(gw)} is less than the goods alone (${kg(goods)}), before cartons and pallets.`, numbers };
    },
  },
  {
    ...meta("R-08"),
    check(ctx) {
      const b = ctx.booking;
      if (b.destinationType == null) return notChecked("the destination type is missing");
      if (b.destinationType !== "Warehouse") return { status: "pass", message: "Business address: no delivery appointment needed." };
      if (b.appointmentBooked == null) return notChecked("delivery appointment answer is missing");
      if (b.appointmentBooked) return { status: "pass", message: "Warehouse delivery appointment is booked." };
      return { status: "fail", message: "This goes to a warehouse but no delivery appointment is booked; warehouses can refuse unbooked deliveries." };
    },
  },
  {
    ...meta("R-09"),
    check(ctx) {
      if (ctx.noItems) return notChecked("the booking has no items");
      const waiting = ctx.items.filter((i) => !i.countryOfOrigin && ctx.pendingFields.has(`countryOfOrigin@${i.rowId}`));
      const bad = ctx.items.filter((i) => !i.countryOfOrigin && !waiting.includes(i));
      if (!bad.length && waiting.length) return notChecked("the country of origin hasn't been asked for yet");
      if (!bad.length) return { status: "pass", message: "Every item has a country of origin." };
      return { status: "fail", message: `Country of origin missing for ${bad.map((i) => label(ctx, i.rowId)).join("; ")}.`, itemRowIds: bad.map((i) => i.rowId) };
    },
  },
  {
    ...meta("R-10"),
    check(ctx) {
      const r = ctx.booking.readyDate;
      if (!r) return notChecked("the ready-to-ship date is missing or unreadable");
      if (r >= ctx.today) return { status: "pass", message: `Ready date ${prettyDate(r)} is not in the past (today counts).` };
      return { status: "fail", message: `Ready date ${prettyDate(r)} is in the past (today is ${prettyDate(ctx.today)}, Europe/London).`, numbers: [`Ready ${prettyDate(r)} < today ${prettyDate(ctx.today)}`] };
    },
  },
];

export function runRules(ctx: RuleCtx): RuleResult[] {
  return RULES.map((r) => ({ id: r.id, severity: r.severity, text: r.text, ...r.check(ctx) }));
}

/** Per-check failure keys used by the repair engine: "R-02", "R-03@<rowId>", "R-04", ... */
export function failureKeys(results: RuleResult[]): Set<string> {
  const keys = new Set<string>();
  for (const r of results) {
    if (r.status !== "fail") continue;
    if (r.id === "R-03" && r.itemRowIds?.length) r.itemRowIds.forEach((id) => keys.add(`R-03@${id}`));
    else keys.add(r.id);
  }
  return keys;
}

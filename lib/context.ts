// Builds the read-only context the rules check against: sums over usable items,
// carrier evaluation and hazard classification. No pass/fail decisions here.
import { evaluateCarriers } from "./carrier";
import { DEFAULT_WEIGHTS } from "./config";
import { round2, round3 } from "./format";
import { classifyHazard } from "./hazards";
import type { Booking, CarrierResult, Env, HazardKind, Item } from "./types";

export interface HazardInfo {
  kind: HazardKind;
  matched: string | null;
  source: "keyword" | "list" | "model" | null;
}

export interface RuleCtx {
  booking: Booking;
  items: Item[];
  today: string;
  noItems: boolean;
  /** Items usable for each identity (all numbers that identity needs are present). */
  usable: {
    value: Item[]; // quantity + unit price
    cartonMaths: Item[]; // quantity + units per carton + cartons
    cartons: Item[]; // cartons
    weight: Item[]; // quantity + unit weight
  };
  /** Items excluded from a given identity because a number is missing (D-02/D-06). */
  excluded: { value: Item[]; cartonMaths: Item[]; cartons: Item[]; weight: Item[] };
  sums: { value: number; cartons: number; goodsWeight: number };
  carrier: CarrierResult;
  hazards: Record<string, HazardInfo>;
  /** Chat fields not asked yet ("hsCode@<rowId>"). */
  pendingFields: Set<string>;
}

const has = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

export function buildContext(booking: Booking, env: Env): RuleCtx {
  const items = booking.items;
  const split = (pred: (i: Item) => boolean) => ({ ok: items.filter(pred), bad: items.filter((i) => !pred(i)) });
  const value = split((i) => has(i.quantity) && has(i.unitPrice));
  const cartonMaths = split((i) => has(i.quantity) && has(i.unitsPerCarton) && has(i.cartons));
  const cartons = split((i) => has(i.cartons));
  const weight = split((i) => has(i.quantity) && has(i.unitWeight));

  const hazards: Record<string, HazardInfo> = {};
  for (const it of items) {
    const local = classifyHazard(`${it.description ?? ""}`);
    let info: HazardInfo = { kind: local.kind, matched: local.matched, source: local.kind === "explicit" ? "keyword" : local.kind === "implied" ? "list" : null };
    const hint = env.hazardHints?.[it.rowId];
    // The model may only ADD an implied classification; it can never downgrade.
    if (info.kind === "none" && hint === "implied") info = { kind: "implied", matched: "model classification", source: "model" };
    hazards[it.rowId] = info;
  }

  return {
    booking,
    items,
    today: env.today,
    noItems: items.length === 0,
    usable: { value: value.ok, cartonMaths: cartonMaths.ok, cartons: cartons.ok, weight: weight.ok },
    excluded: { value: value.bad, cartonMaths: cartonMaths.bad, cartons: cartons.bad, weight: weight.bad },
    sums: {
      value: round2(value.ok.reduce((s, i) => s + i.quantity! * i.unitPrice!, 0)),
      cartons: cartons.ok.reduce((s, i) => s + i.cartons!, 0),
      goodsWeight: round3(weight.ok.reduce((s, i) => s + i.unitWeight! * i.quantity!, 0)),
    },
    carrier: evaluateCarriers(booking, env.weights ?? DEFAULT_WEIGHTS),
    hazards,
    pendingFields: new Set(env.pendingFields ?? []),
  };
}

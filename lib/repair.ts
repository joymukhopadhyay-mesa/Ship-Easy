// Repair engine (spec A9). Proposes values ONLY for mutable fields (trust.ts) and
// accepts a candidate only if re-running the rulebook shows it clears every failing
// check in its cluster and breaks no passing check anywhere. Three stages:
//   1. single field  2. bounded pair (one booking-level + one item-level)  3. honest fallback.
import { PAIR_SEARCH_CAP, TRADE_TARIFF_URL } from "./config";
import { buildContext, type RuleCtx } from "./context";
import { fmtNum, gbp, isInt, kg, round2 } from "./format";
import { failureKeys, runRules } from "./rulebook";
import { FIELD_KIND, isMutable } from "./trust";
import type { Booking, Change, CarrierId, Env, MutableField, Repair, RuleId, RuleResult } from "./types";

export const STAGE3_MESSAGE = "Two or more numbers conflict and we can't tell which is wrong. Please confirm the actual carton count and quantity.";

const BOOKING_KEY: Partial<Record<MutableField, keyof Booking>> = {
  "booking.pallets": "pallets",
  "booking.cartons": "cartons",
  "booking.declared_value": "declaredValue",
  "booking.gross_weight": "grossWeight",
};
const ITEM_KEY = { "item.hs_code": "hsCode", "item.quantity": "quantity", "item.cartons": "cartons" } as const;

/** Returns a new booking with the changes applied. Throws on a non-mutable field. */
export function applyChanges(booking: Booking, changes: Change[]): Booking {
  const b: Booking = { ...booking, items: booking.items.map((i) => ({ ...i })) };
  for (const c of changes) {
    if (!isMutable(c.field)) throw new Error(`refusing to change trusted field ${c.field}`);
    const bk = BOOKING_KEY[c.field];
    if (bk) (b as unknown as Record<string, unknown>)[bk] = c.to;
    else {
      const it = b.items.find((i) => i.rowId === c.rowId);
      if (!it) throw new Error(`unknown item ${c.rowId}`);
      (it as unknown as Record<string, unknown>)[ITEM_KEY[c.field as keyof typeof ITEM_KEY]] = c.to;
    }
  }
  return b;
}

/** Chat: booking totals the app computes from the items follow any item change (they are not evidence). */
export function derive(b: Booking, env: Env): Booking {
  if (!env.derived) return b;
  const out = { ...b };
  const all = (f: (i: Booking["items"][number]) => boolean) => b.items.length > 0 && b.items.every(f);
  if (env.derived.declaredValue && all((i) => i.quantity != null && i.unitPrice != null)) out.declaredValue = round2(b.items.reduce((t, i) => t + i.quantity! * i.unitPrice!, 0));
  if (env.derived.cartons && all((i) => i.cartons != null)) out.cartons = b.items.reduce((t, i) => t + i.cartons!, 0);
  return out;
}

const isDerived = (env: Env, field: MutableField) =>
  (field === "booking.declared_value" && !!env.derived?.declaredValue) || (field === "booking.cartons" && !!env.derived?.cartons);
const confirmedIn = (env: Env, cs: Change[]) => cs.filter((c) => c.rowId && env.confirmed?.includes(`${c.field}@${c.rowId}`));

const current = (b: Booking, field: MutableField, rowId?: string): number | string | null => {
  const bk = BOOKING_KEY[field];
  if (bk) return b[bk] as number | null;
  const it = b.items.find((i) => i.rowId === rowId);
  return it ? (it[ITEM_KEY[field as keyof typeof ITEM_KEY]] as number | string | null) : null;
};

const relChange = (cs: Change[]) =>
  cs.reduce((s, c) => s + Math.abs(Number(c.to) - Number(c.from ?? 0)) / Math.max(Math.abs(Number(c.from ?? 0)), 1), 0);
const sig = (cs: Change[]) => JSON.stringify([...cs].map((c) => [c.field, c.rowId ?? "", c.to]).sort());

type Eval = { keys: Set<string>; results: RuleResult[]; ctx: RuleCtx };
function evaluate(b: Booking, env: Env): Eval {
  const ctx = buildContext(b, env);
  const results = runRules(ctx);
  return { keys: failureKeys(results), results, ctx };
}

/** Identity checks the repair search works over and the mutable fields each can be repaired through. */
function nodeFields(key: string, ctx: RuleCtx): { field: MutableField; rowId?: string }[] {
  if (key === "R-02") return [{ field: "booking.declared_value" }, ...ctx.usable.value.map((i) => ({ field: "item.quantity" as const, rowId: i.rowId }))];
  if (key === "R-04") return [{ field: "booking.cartons" }, ...ctx.usable.cartons.map((i) => ({ field: "item.cartons" as const, rowId: i.rowId }))];
  if (key === "R-07") return [{ field: "booking.gross_weight" }];
  if (key.startsWith("R-03@")) {
    const rowId = key.slice(5);
    return [{ field: "item.quantity", rowId }, { field: "item.cartons", rowId }];
  }
  return [];
}
const IDENTITY = (k: string) => k === "R-02" || k === "R-04" || k === "R-07" || k.startsWith("R-03@");
const ruleOf = (k: string) => k.slice(0, 4) as RuleId;
const fkey = (f: { field: MutableField; rowId?: string }) => `${f.field}|${f.rowId ?? ""}`;

/** Candidate values for one field, implied by trusted fields and the other identities. */
function candidates(b: Booking, ctx: RuleCtx, field: MutableField, rowId?: string): number[] {
  const out: number[] = [];
  const posInt = (x: number) => { if (x > 0 && isInt(x)) out.push(Math.round(x)); };
  if (field === "booking.declared_value") out.push(round2(ctx.sums.value));
  else if (field === "booking.cartons") out.push(ctx.sums.cartons);
  else if (field === "booking.gross_weight") out.push(Math.ceil(ctx.sums.goodsWeight * 100 - 1e-6) / 100);
  else {
    const it = b.items.find((i) => i.rowId === rowId)!;
    if (field === "item.quantity") {
      if (it.unitsPerCarton != null && it.cartons != null) posInt(it.unitsPerCarton * it.cartons);
      if (b.declaredValue != null && it.unitPrice) {
        const others = ctx.usable.value.filter((i) => i.rowId !== rowId).reduce((s, i) => s + i.quantity! * i.unitPrice!, 0);
        const implied = (b.declaredValue - others) / it.unitPrice;
        if (isInt(implied)) posInt(implied);
      }
    } else if (field === "item.cartons") {
      if (it.quantity != null && it.unitsPerCarton) posInt(it.quantity / it.unitsPerCarton);
      if (b.cartons != null) posInt(b.cartons - ctx.usable.cartons.filter((i) => i.rowId !== rowId).reduce((s, i) => s + i.cartons!, 0));
    }
  }
  return [...new Set(out)];
}

function mkChange(b: Booking, field: MutableField, to: number, rowId?: string): Change | null {
  const from = current(b, field, rowId);
  if (from === to) return null;
  const sku = rowId ? b.items.find((i) => i.rowId === rowId)?.sku : undefined;
  return { field, ...(rowId ? { rowId, sku } : {}), from, to };
}

interface Scored { changes: Change[]; fixed: number; broken: number; rel: number; after: Eval }

function trial(b: Booking, env: Env, base: Eval, failing: string[], changes: Change[]): Scored | null {
  const after = evaluate(derive(applyChanges(b, changes), env), env);
  if (failing.some((k) => after.keys.has(k))) return null; // must clear every failing check in the cluster
  const broken = [...after.keys].filter((k) => !base.keys.has(k)).length;
  if (broken > 0) return null; // invariant: no suggested value may fail a rule
  const fixed = [...base.keys].filter((k) => !after.keys.has(k)).length;
  return { changes, fixed, broken, rel: relChange(changes), after };
}

function arithmetic(b: Booking, s: Scored): string[] {
  const lines: string[] = [];
  const r = Object.fromEntries(s.after.results.map((x) => [x.id, x]));
  const fields = new Set(s.changes.map((c) => c.field));
  for (const c of s.changes) {
    if (c.field === "item.quantity" || c.field === "item.cartons") {
      const it = s.after.ctx.items.find((i) => i.rowId === c.rowId)!;
      lines.push(`${it.sku}: ${fmtNum(it.unitsPerCarton)} per carton × ${fmtNum(it.cartons)} cartons = ${fmtNum(it.unitsPerCarton! * it.cartons!)} = quantity ${fmtNum(it.quantity)}`);
    }
  }
  if (fields.has("booking.declared_value") || fields.has("item.quantity")) lines.push(...(r["R-02"].numbers?.slice(0, 1) ?? []));
  if (fields.has("booking.cartons") || fields.has("item.cartons")) lines.push(...(r["R-04"].numbers?.slice(0, 1) ?? []));
  if (fields.has("booking.gross_weight")) lines.push(...(r["R-07"].numbers?.slice(0, 1) ?? []));
  void b;
  return lines;
}

const describe = (c: Change) => {
  const name = { "booking.pallets": "pallets", "booking.cartons": "booking cartons", "booking.declared_value": "declared value", "booking.gross_weight": "gross weight", "item.hs_code": "HS code", "item.quantity": "quantity", "item.cartons": "cartons" }[c.field];
  const val = (v: unknown) => (c.field === "booking.declared_value" ? gbp(Number(v)) : c.field === "booking.gross_weight" ? kg(Number(v)) : fmtNum(Number(v)));
  return `${c.sku ? c.sku + " " : ""}${name} ${val(c.from)} → ${val(c.to)}`;
};

function confidenceFor(changes: Change[]): "High" | "Possible" {
  // weight is NEVER High; counts must be integers; money is rounded to 2 dp.
  for (const c of changes) {
    const k = FIELD_KIND[c.field];
    if (k === "weight") return "Possible";
    if (k === "count" && !isInt(Number(c.to))) return "Possible";
  }
  return "High";
}

function repairCluster(b: Booking, env: Env, base: Eval, failing: string[]): Repair[] {
  const rules = [...new Set(failing.map(ruleOf))].sort() as RuleId[];
  const fields = new Map<string, { field: MutableField; rowId?: string }>();
  for (const k of failing) for (const f of nodeFields(k, base.ctx)) if (!isDerived(env, f.field)) fields.set(fkey(f), f);

  // ---- Stage 1: single field
  const accepted: Scored[] = [];
  const seen = new Set<string>();
  for (const f of fields.values()) {
    for (const v of candidates(b, base.ctx, f.field, f.rowId)) {
      const ch = mkChange(b, f.field, v, f.rowId);
      if (!ch || seen.has(sig([ch]))) continue;
      seen.add(sig([ch]));
      const s = trial(b, env, base, failing, [ch]);
      if (s) accepted.push(s);
    }
  }
  if (accepted.length) {
    accepted.sort((x, y) => y.fixed - y.broken - (x.fixed - x.broken) || x.rel - y.rel);
    const top = accepted[0];
    const floorRepair = top.changes[0].field === "booking.gross_weight";
    if (accepted.length > 1 && Math.abs(accepted[1].rel - top.rel) < 1e-9 && accepted[1].fixed - accepted[1].broken === top.fixed - top.broken) {
      const tied = accepted.filter((a) => Math.abs(a.rel - top.rel) < 1e-9);
      return [{ rules, stage: 1, confidence: "Ambiguous", changes: [], options: tied.map((t) => t.changes), applyEnabled: false, arithmetic: tied.flatMap((t) => arithmetic(b, t)), message: `Two fixes fit equally well: ${tied.map((t) => t.changes.map(describe).join(" + ")).join(" OR ")}. Please tell us which number is right.` }];
    }
    const confirmedHit = confirmedIn(env, top.changes);
    const conf = accepted.length === 1 && !confirmedHit.length ? confidenceFor(top.changes) : "Possible";
    const r: Repair = {
      rules, stage: 1, confidence: conf, changes: top.changes, applyEnabled: conf === "High",
      arithmetic: arithmetic(b, top),
      message: floorRepair
        ? `Gross weight must be at least ${kg(Number(top.changes[0].to))} (the goods alone, before cartons and pallets). Please check the real weighed total; we can't know the packaging weight.`
        : confirmedHit.length
        ? `You confirmed ${confirmedHit.map((c) => `${c.sku} ${c.field === "item.quantity" ? "quantity" : "cartons"} = ${fmtNum(Number(c.from))}`).join(" and ")}, so we won't change it. The numbers only add up if ${top.changes.map(describe).join(" + ")}; please check the units per carton and the real carton count.`
        : `Change ${top.changes.map(describe).join(" + ")}.${accepted.length > 1 ? ` Other fits: ${accepted.slice(1).map((a) => a.changes.map(describe).join(" + ")).join("; ")}.` : ""}`,
    };
    if (floorRepair) r.floor = Number(top.changes[0].to);
    return [r];
  }

  // ---- Stage 2: bounded pair (one booking-level + one item-level field)
  const pairs: Scored[] = [];
  const pseen = new Set<string>();
  let combos = 0;
  outer: for (const it of b.items) {
    for (const itemField of ["item.quantity", "item.cartons"] as MutableField[]) {
      for (const v of candidates(b, base.ctx, itemField, it.rowId)) {
        const ich = mkChange(b, itemField, v, it.rowId);
        if (!ich) continue;
        const mid = derive(applyChanges(b, [ich]), env);
        const midCtx = buildContext(mid, env);
        for (const bf of ["booking.declared_value", "booking.cartons", "booking.gross_weight"] as MutableField[]) {
          if (isDerived(env, bf)) continue;
          if (++combos > PAIR_SEARCH_CAP) break outer;
          const bv = candidates(mid, midCtx, bf)[0];
          if (bv === undefined) continue;
          if (bf === "booking.gross_weight" && mid.grossWeight != null && bv <= mid.grossWeight) continue;
          const bch = mkChange(b, bf, bv);
          if (!bch) continue;
          const cs = [bch, ich];
          if (pseen.has(sig(cs))) continue;
          pseen.add(sig(cs));
          const s = trial(b, env, base, failing, cs);
          if (s) pairs.push(s);
        }
      }
    }
  }
  if (pairs.length === 1) {
    const conf = confirmedIn(env, pairs[0].changes).length ? "Possible" : confidenceFor(pairs[0].changes);
    return [{ rules, stage: 2, confidence: conf, changes: pairs[0].changes, applyEnabled: conf === "High", arithmetic: arithmetic(b, pairs[0]), message: `Two numbers were wrong. Change ${pairs[0].changes.map(describe).join(" and ")}; this is the only pair of changes that makes every check pass.` }];
  }
  if (pairs.length > 1) {
    return [{ rules, stage: 2, confidence: "Ambiguous", changes: [], options: pairs.map((p) => p.changes), applyEnabled: false, arithmetic: pairs.flatMap((p) => arithmetic(b, p)), message: `More than one pair of changes would fix this: ${pairs.map((p) => p.changes.map(describe).join(" + ")).join(" OR ")}. We won't guess; please confirm which numbers are right.` }];
  }

  // ---- Stage 3: honest fallback, one report per broken check, never applied
  return failing.map((k) => {
    const opts: Change[] = [];
    for (const f of nodeFields(k, base.ctx)) {
      if (isDerived(env, f.field)) continue;
      if (k === "R-02" && f.field !== "booking.declared_value") continue;
      if (k === "R-04" && f.field !== "booking.cartons") continue;
      for (const v of candidates(b, base.ctx, f.field, f.rowId)) {
        if (k.startsWith("R-03@")) {
          const it = b.items.find((i) => i.rowId === f.rowId)!;
          const fromR03 = f.field === "item.quantity" ? it.unitsPerCarton! * it.cartons! : it.quantity! / it.unitsPerCarton!;
          if (v !== fromR03) continue;
        }
        const c = mkChange(b, f.field, v, f.rowId);
        if (c) opts.push(c);
      }
    }
    opts.sort((x, y) => relChange([x]) - relChange([y]));
    const best = opts[0];
    const it = k.startsWith("R-03@") ? b.items.find((i) => i.rowId === k.slice(5)) : undefined;
    return {
      rules: [ruleOf(k)], stage: 3 as const, confidence: "Possible" as const, changes: best ? [best] : [], applyEnabled: false,
      arithmetic: (base.results.find((r) => r.id === ruleOf(k))?.numbers ?? []).filter((n) => !it || n.startsWith(it.sku)),
      message: `${STAGE3_MESSAGE}${best ? ` Most likely: ${describe(best)} — not applied.` : ""}`,
      ...(it ? { itemRowId: it.rowId } : {}),
    };
  });
}

/** All data-correction proposals for a validated booking. */
export function computeRepairs(booking: Booking, env: Env, results: RuleResult[], ctx: RuleCtx): Repair[] {
  const base: Eval = { keys: failureKeys(results), results, ctx };
  const repairs: Repair[] = [];

  // R-01: no value can be safely invented for an HS code.
  const r01 = results.find((r) => r.id === "R-01");
  if (r01?.status === "fail") {
    repairs.push({
      rules: ["R-01"], stage: null, confidence: "Possible", changes: [], applyEnabled: false, arithmetic: r01.numbers ?? [],
      message: `Add the full HS code (at least 6 digits) for each flagged item; look it up at ${TRADE_TARIFF_URL}.${r01.caveat ? " " + r01.caveat : ""}`,
    });
  }

  // Identity cluster (R-02, R-03 per item, R-04, R-07): connected components via shared mutable fields.
  const failing = [...base.keys].filter(IDENTITY);
  const parent = new Map(failing.map((k) => [k, k]));
  const find = (k: string): string => (parent.get(k) === k ? k : find(parent.get(k)!));
  const owner = new Map<string, string>();
  for (const k of failing) {
    for (const f of nodeFields(k, ctx)) {
      const o = owner.get(fkey(f));
      if (o) parent.set(find(k), find(o));
      else owner.set(fkey(f), k);
    }
  }
  const groups = new Map<string, string[]>();
  for (const k of failing) groups.set(find(k), [...(groups.get(find(k)) ?? []), k]);
  const clusterRepairs = [...groups.values()].map((g) => repairCluster(booking, env, base, g.sort())).flat();

  // A High fix elsewhere that also clears R-07 makes the separate weight-floor note redundant.
  const highClearsR07 = clusterRepairs.some((r) => r.confidence === "High" && !r.rules.includes("R-07") && !evaluate(derive(applyChanges(booking, r.changes), env), env).keys.has("R-07"));
  for (const r of clusterRepairs) {
    if (highClearsR07 && r.rules.length === 1 && r.rules[0] === "R-07") continue;
    repairs.push(r);
  }
  return repairs;
}

export interface SellerAction {
  id: string;
  label: string;
  rules: RuleId[];
  changes?: Change[];
  setCarrier?: CarrierId | null;
  setAppointment?: boolean;
}

/** One-click seller actions for operational (not data-error) findings. Each is rule-checked. */
export function sellerActions(booking: Booking, results: RuleResult[], ctx: RuleCtx): SellerAction[] {
  const out: SellerAction[] = [];
  const c = ctx.carrier;
  const r05 = results.find((r) => r.id === "R-05");
  if (r05?.status === "fail" && booking.pallets != null) {
    if (c.r05 === "seller_override" && c.chosen) {
      const rec = c.recommended ? c.options.find((o) => o.id === c.recommended)! : null;
      if (rec) out.push({ id: "switch", label: `Switch to ${rec.name} (${gbp(rec.totalCost)})`, rules: ["R-05"], setCarrier: null });
      const need = c.minPallets[c.chosen];
      if (need && need > booking.pallets) out.push({ id: "add-pallets", label: `Keep ${c.chosen}: use ${need} pallets (+${need - booking.pallets})`, rules: ["R-05"], changes: [{ field: "booking.pallets", from: booking.pallets, to: need }] });
    } else {
      const byCount = new Map<number, CarrierId[]>();
      for (const [id, n] of Object.entries(c.minPallets) as [CarrierId, number][]) byCount.set(n, [...(byCount.get(n) ?? []), id]);
      for (const [n, ids] of [...byCount.entries()].sort((a, b) => a[0] - b[0])) {
        if (n <= booking.pallets) continue;
        out.push({ id: `pallets-${n}`, label: `Re-pack onto ${n} pallets (opens ${ids.map((i) => "Carrier " + i).join(", ")})`, rules: ["R-05"], changes: [{ field: "booking.pallets", from: booking.pallets, to: n }] });
      }
    }
  }
  const r08 = results.find((r) => r.id === "R-08");
  if (r08?.status === "fail") out.push({ id: "appointment", label: "I've booked the delivery appointment", rules: ["R-08"], setAppointment: true });
  return out;
}

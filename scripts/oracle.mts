// Independent oracle. Recomputes expected values straight from the raw fixture
// workbooks using the formulas in the build prompt. Imports NOTHING from /lib or
// /data: the rate card is read from each fixture's own "Carrier options" sheet.
// Run: npm run oracle   (exit code 1 on any disagreement)
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

XLSX.set_fs(fs);
const FIX = path.resolve("fixtures");
const expected = JSON.parse(fs.readFileSync(path.join(FIX, "expected.json"), "utf8"));
const TODAY = expected.today as string; // 2026-10-25

type Row = Record<string, string>;
const problems: string[] = [];
const fail = (where: string, msg: string) => problems.push(`${where}: ${msg}`);

function readSheet(wb: XLSX.WorkBook, name: string, firstHeader: string): { rows: Row[]; rowNums: number[] } {
  const aoa: string[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" });
  const h = aoa.findIndex((r) => r.map((c) => String(c).trim()).includes(firstHeader));
  const headers = aoa[h].map((c) => String(c).trim());
  const rows: Row[] = [];
  const rowNums: number[] = [];
  // skip the grey example row (h+1)
  for (let i = h + 2; i < aoa.length; i++) {
    if (!aoa[i].some((c) => String(c).trim() !== "")) continue;
    const r: Row = {};
    headers.forEach((k, j) => (r[k] = String(aoa[i][j] ?? "").trim()));
    rows.push(r);
    rowNums.push(i + 1);
  }
  return { rows, rowNums };
}

const num = (s: string) => (s === "" ? NaN : Number(s));
const iso = (ddmmyyyy: string) => { const [d, m, y] = ddmmyyyy.split("-"); return `${y}-${m}-${d}`; };
const dow = (isoDate: string) => new Date(isoDate + "T00:00:00Z").getUTCDay(); // 0 Sun..6 Sat
const addDays = (isoDate: string, n: number) => { const t = new Date(isoDate + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const toWeekday = (isoDate: string) => { const d = dow(isoDate); return d === 6 ? addDays(isoDate, 2) : d === 0 ? addDays(isoDate, 1) : isoDate; };
const r2 = (x: number) => Math.round(x * 100) / 100;

type Carrier = { id: string; lane: string; price: number; transit: number; onTime: number; cap: number };
function rateCard(wb: XLSX.WorkBook): Carrier[] {
  return readSheetNoExample(wb, "Carrier options", "Carrier").map((r) => ({
    id: r["Carrier"].replace("Carrier ", ""), lane: r["Destination country"], price: num(r["Price per pallet"]),
    transit: num(r["Transit time (days)"]), onTime: num(r["On-time rate (%)"]), cap: num(r["Max weight per pallet (kg)"]),
  }));
}
function readSheetNoExample(wb: XLSX.WorkBook, name: string, firstHeader: string): Row[] {
  const aoa: string[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: "" });
  const h = aoa.findIndex((r) => r.map((c) => String(c).trim()).includes(firstHeader));
  const headers = aoa[h].map((c) => String(c).trim());
  return aoa.slice(h + 1).filter((r) => r.some((c) => String(c).trim() !== "")).map((r) => {
    const o: Row = {}; headers.forEach((k, j) => (o[k] = String(r[j] ?? "").trim())); return o;
  });
}

function rank(feasible: (Carrier & { cost: number })[], priority: string) {
  const by = (...keys: ((c: Carrier & { cost: number }) => number)[]) =>
    [...feasible].sort((a, b) => { for (const k of keys) { const d = k(a) - k(b); if (d !== 0) return d; } return 0; });
  if (priority === "Cheapest") return by((c) => c.cost, (c) => c.transit, (c) => -c.onTime)[0];
  if (priority === "Fastest") return by((c) => c.transit, (c) => -c.onTime, (c) => c.cost)[0];
  if (priority === "Most reliable") return by((c) => -c.onTime, (c) => c.transit, (c) => c.cost)[0];
  const scores = balanced(feasible);
  return by((c) => scores[c.id])[0];
}
function balanced(f: (Carrier & { cost: number })[]) {
  const norm = (vals: number[], v: number) => { const mn = Math.min(...vals), mx = Math.max(...vals); return mx === mn ? 0 : (v - mn) / (mx - mn); };
  const out: Record<string, number> = {};
  for (const c of f) {
    out[c.id] = r2(0.4 * norm(f.map((x) => x.cost), c.cost) + 0.3 * norm(f.map((x) => x.transit), c.transit)
      + 0.3 * norm(f.map((x) => -x.onTime), -c.onTime));
  }
  return out;
}

type Item = { sku: string; desc: string; hs: string; qty: number; price: number; upc: number; cartons: number; uw: number; origin: string };
type Booking = { id: string; destCountry: string; destType: string; ready: string; priority: string; pallets: number; cartons: number; value: number; gross: number; appt: string; chosen: string };

function compute(b: Booking, items: Item[], cards: Carrier[]) {
  const rules: Record<string, string> = {};
  const gate: string[] = [];
  const noItems = items.length === 0;
  if (noItems) gate.push("D-01");
  const palletsOk = Number.isFinite(b.pallets) && b.pallets > 0;
  if (!palletsOk) gate.push("D-05");
  const hsDigits = (hs: string) => hs.replace(/\.0$/, "").replace(/[.\s]/g, "");
  rules["R-01"] = noItems ? "not_checked" : items.every((i) => /^\d{6,}$/.test(hsDigits(i.hs))) ? "pass" : "fail";
  const sum = items.reduce((s, i) => s + i.qty * i.price, 0);
  rules["R-02"] = noItems ? "not_checked" : Math.abs(b.value - sum) <= 0.01 * sum ? "pass" : "fail";
  rules["R-03"] = noItems ? "not_checked" : items.every((i) => i.upc * i.cartons === i.qty) ? "pass" : "fail";
  rules["R-04"] = noItems ? "not_checked" : items.reduce((s, i) => s + i.cartons, 0) === b.cartons ? "pass" : "fail";
  const lane = cards.filter((c) => c.lane === b.destCountry);
  let kg: number | null = null, feasible: (Carrier & { cost: number })[] = [], rec: Carrier | null = null, chosen: Carrier | null = null, r05 = "cannot_compute";
  if (palletsOk) {
    kg = b.gross / b.pallets;
    feasible = lane.filter((c) => kg! <= c.cap).map((c) => ({ ...c, cost: c.price * b.pallets }));
    rec = feasible.length ? rank(feasible, b.priority) : null;
    const override = b.chosen ? lane.find((c) => c.id === b.chosen.replace("Carrier ", "")) ?? null : null;
    chosen = override ?? rec;
    if (override && kg > override.cap) r05 = "seller_override";
    else if (!feasible.length) r05 = "no_carrier_fits";
    else r05 = "pass";
  }
  rules["R-05"] = r05 === "pass" ? "pass" : r05 === "cannot_compute" ? "cannot_compute" : "fail";
  const explicit = /lithium|li-ion|aerosol|flammable/i;
  const implied = /wireless earbuds|bluetooth speaker|cordless vacuum|nail polish|hand sanitiser/i;
  const hazard = items.find((i) => explicit.test(i.desc) || implied.test(i.desc));
  rules["R-06"] = noItems ? "not_checked" : hazard ? "fail" : "pass";
  const goods = items.reduce((s, i) => s + i.uw * i.qty, 0);
  rules["R-07"] = noItems ? "not_checked" : b.gross >= goods - 1e-9 ? "pass" : "fail";
  rules["R-08"] = b.destType === "Warehouse" && b.appt !== "Yes" ? "fail" : "pass";
  rules["R-09"] = noItems ? "not_checked" : items.every((i) => i.origin !== "") ? "pass" : "fail";
  rules["R-10"] = b.ready >= TODAY ? "pass" : "fail";
  const reds = ["R-01", "R-02", "R-03", "R-04", "R-05", "R-06"].some((r) => rules[r] === "fail");
  const ambers = ["R-07", "R-08", "R-09", "R-10"].some((r) => rules[r] === "fail");
  const verdict = reds ? "BLOCKED" : gate.length ? "INCOMPLETE" : ambers ? "SHIP WITH CARE" : "CLEAR TO SHIP";
  const collection = toWeekday(b.ready);
  const carrierForDates = chosen;
  const eta = carrierForDates ? toWeekday(addDays(collection, carrierForDates.transit)) : null;
  const minPallets = Object.fromEntries(lane.map((c) => [c.id, Math.ceil(b.gross / c.cap)]));
  return {
    verdict, rules, gate, kgPerPallet: kg === null ? null : r2(kg), r05, feasible: feasible.map((c) => c.id),
    recommended: rec?.id ?? null, chosen: chosen?.id ?? null,
    totalCost: chosen && palletsOk ? chosen.price * b.pallets : null,
    dates: { ready: b.ready, collection, eta }, minPallets, lane, hazard, goods, sum,
    balancedScores: feasible.length ? balanced(feasible) : {},
    etaAll: Object.fromEntries(lane.map((c) => [c.id, toWeekday(addDays(collection, c.transit))])),
  };
}

function eq(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function check(where: string, got: Record<string, unknown>, exp: Record<string, unknown>, keys: string[]) {
  for (const k of keys) if (k in exp && !eq(got[k], exp[k])) fail(where, `${k} expected ${JSON.stringify(exp[k])} oracle ${JSON.stringify(got[k])}`);
}

// Applies repair changes and re-checks the identity rules R-02/R-03/R-04/R-07.
function identitiesPass(b: Booking, items: Item[], changes: { field: string; sku?: string; to: number }[]) {
  const bb = { ...b }; const ii = items.map((i) => ({ ...i }));
  for (const c of changes) {
    if (c.field === "booking.declared_value") bb.value = c.to;
    else if (c.field === "booking.cartons") bb.cartons = c.to;
    else if (c.field === "booking.gross_weight") bb.gross = c.to;
    else if (c.field === "booking.pallets") bb.pallets = c.to;
    else { const it = ii.find((x) => x.sku === c.sku)!; if (c.field === "item.quantity") it.qty = c.to; if (c.field === "item.cartons") it.cartons = c.to; }
  }
  const sum = ii.reduce((s, i) => s + i.qty * i.price, 0);
  return Math.abs(bb.value - sum) <= 0.01 * sum && ii.every((i) => i.upc * i.cartons === i.qty)
    && ii.reduce((s, i) => s + i.cartons, 0) === bb.cartons && bb.gross >= ii.reduce((s, i) => s + i.uw * i.qty, 0);
}

let checked = 0;
for (const fx of expected.fixtures) {
  const wb = XLSX.readFile(path.join(FIX, fx.file));
  const cards = rateCard(wb);
  const B = readSheet(wb, "Bookings", "Booking ID");
  const I = readSheet(wb, "Items", "Booking ID");
  const ids = new Set(B.rows.map((r) => r["Booking ID"]));
  const unmatched = I.rows.map((r, k) => ({ r, row: I.rowNums[k] })).filter(({ r }) => !ids.has(r["Booking ID"]))
    .map(({ r, row }) => ({ bookingId: r["Booking ID"], sku: r["SKU"], row }));
  if (!eq(unmatched, fx.unmatched)) fail(fx.id, `unmatched expected ${JSON.stringify(fx.unmatched)} oracle ${JSON.stringify(unmatched)}`);

  let incomplete = 0, validated = 0;
  for (const r of B.rows) {
    const hasItems = I.rows.some((i) => i["Booking ID"] === r["Booking ID"]);
    const p = num(r["Pallets"]);
    if (!hasItems || !(p > 0)) incomplete++; else validated++;
  }
  validated += I.rows.length - unmatched.length;
  const total = B.rows.length + I.rows.length;
  const recon = `${total} ${total === 1 ? "row" : "rows"} read, ${validated} validated, ${unmatched.length} unmatched, ${incomplete} incomplete`;
  if (recon !== fx.reconciliation) fail(fx.id, `reconciliation expected "${fx.reconciliation}" oracle "${recon}"`);

  for (const eb of fx.bookings) {
    const r = B.rows.find((x) => x["Booking ID"] === eb.bookingId)!;
    const b: Booking = {
      id: r["Booking ID"], destCountry: r["Destination country"], destType: r["Destination type"], ready: iso(r["Ready to ship date"]),
      priority: r["Seller priority"], pallets: num(r["Pallets"]), cartons: num(r["Cartons"]), value: num(r["Total declared value"]),
      gross: num(r["Total gross weight (kg)"]), appt: r["Delivery appointment booked"], chosen: r["Chosen carrier"] ?? "",
    };
    const items: Item[] = I.rows.filter((x) => x["Booking ID"] === b.id).map((x) => ({
      sku: x["SKU"], desc: x["Description"], hs: x["HS code"], qty: num(x["Quantity (units)"]), price: num(x["Unit price"]),
      upc: num(x["Units per carton"]), cartons: num(x["Cartons"]), uw: num(x["Unit weight (kg)"]), origin: x["Country of origin"],
    }));
    const got = compute(b, items, cards);
    const where = `${fx.id}/${b.id}`;
    check(where, got, eb, ["verdict", "rules", "gate", "kgPerPallet", "r05", "feasible", "recommended", "chosen", "totalCost", "dates", "etaAll"]);
    if (eb.minPallets) check(where, got, eb, ["minPallets"]);
    if (eb.hsCaveat) { const d = items[0].hs.replace(/\.0$/, ""); if (d.length !== 5) fail(where, "hsCaveat expects a 5-digit code"); }
    if (eb.hazard && got.hazard?.sku !== eb.hazard.sku) fail(where, "hazard SKU mismatch");
    if (eb.overrideFixes) {
      const recC = got.lane.find((c) => c.id === eb.overrideFixes.switchTo)!;
      if (recC.price * b.pallets !== eb.overrideFixes.switchCost) fail(where, "override switch cost");
      const cap = got.lane.find((c) => c.id === got.chosen)!.cap;
      if (Math.ceil(b.gross / cap) - b.pallets !== eb.overrideFixes.addPallets) fail(where, "override addPallets");
    }
    for (const rep of eb.repairs ?? []) {
      const sets = rep.options ?? (rep.changes?.length ? [rep.changes] : []);
      for (const s of sets) {
        for (const c of s) {
          const from = c.field === "booking.declared_value" ? b.value : c.field === "booking.cartons" ? b.cartons
            : c.field === "booking.gross_weight" ? b.gross : (() => { const it = items.find((i) => i.sku === c.sku)!; return c.field === "item.quantity" ? it.qty : it.cartons; })();
          if (from !== c.from) fail(where, `repair ${c.field} from ${c.from} but file has ${from}`);
        }
        const touchesWeightOnly = s.every((c: { field: string }) => c.field === "booking.gross_weight");
        if (touchesWeightOnly) { if (s[0].to !== r2(got.goods)) fail(where, `R-07 floor should be ${r2(got.goods)}`); }
        else if (rep.rules.some((x: string) => ["R-02", "R-03", "R-04"].includes(x))) {
          // the repaired booking must clear every identity rule that the repair targets
          const others = (eb.repairs as { rules: string[]; changes?: unknown[] }[]).filter((x) => x !== rep && x.rules.includes("R-07"));
          const extra = others.flatMap((x) => (x.changes ?? []) as { field: string; to: number }[]);
          if (!identitiesPass(b, items, [...s, ...extra])) fail(where, `repair ${JSON.stringify(s)} does not clear the identities`);
        }
      }
    }
    for (const v of fx.variants ?? []) {
      const got2 = compute({ ...b, ...v.change }, items, cards);
      check(`${where}+${JSON.stringify(v.change)}`, got2, v.expect, ["verdict", "rules", "kgPerPallet", "r05", "feasible", "recommended", "chosen", "totalCost", "dates", "balancedScores"]);
    }
    checked++;
  }
  // fixtures 1-10 (+06i): exactly their own rule fails
  if (/^(0\d|10)i?$/.test(fx.id)) {
    const failing = Object.entries(fx.bookings[0].rules).filter(([, s]) => s === "fail").map(([k]) => k);
    const own = `R-${fx.id.replace("i", "").padStart(2, "0")}`;
    if (!eq(failing, [own]) || !eq(fx.breaks, [own])) fail(fx.id, `should break exactly ${own}, expected.json has ${failing}`);
  }
}

// Extra checks straight from the prompt
const card = rateCard(XLSX.readFile(path.join(FIX, "f17-clean.xlsx")));
const de = card.filter((c) => c.lane === "Germany").map((c) => ({ ...c, cost: c.price * 3 }));
const bw = expected.extraChecks.balancedWorkedCheck;
if (!eq(Object.fromEntries(de.map((c) => [c.id, c.cost])), bw.costs)) fail("balanced", "costs");
if (!eq(balanced(de), bw.scores)) fail("balanced", `scores ${JSON.stringify(balanced(de))}`);
if (rank(de, "Balanced").id !== bw.pick) fail("balanced", "pick");
const thu = expected.extraChecks.bk001ThursdayEtaA;
if (toWeekday(addDays(toWeekday(thu.ready), 5)) !== thu.etaA) fail("dates", "Thursday ETA A");

console.log(`oracle: ${expected.fixtures.length} fixtures, ${checked} bookings checked`);
if (problems.length) { console.log(`DISAGREEMENTS (${problems.length}):\n - ` + problems.join("\n - ")); process.exit(1); }
console.log("oracle: expected.json agrees on every fixture");

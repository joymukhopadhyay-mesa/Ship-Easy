import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import carriers from "@/data/carriers.json";
import rulebook from "@/data/rulebook.json";
import { balancedScores, evaluateCarriers, rank } from "@/lib/carrier";
import { buildContext } from "@/lib/context";
import { addDays, collectionDate, etaDate } from "@/lib/dates";
import { round2 } from "@/lib/format";
import { applyChanges, sellerActions, STAGE3_MESSAGE } from "@/lib/repair";
import { RULES, withinTolerance } from "@/lib/rulebook";
import { validateBooking } from "@/lib/validate";
import type { Booking, Env, Item } from "@/lib/types";
import { TODAY } from "./helpers/loadFixture";

XLSX.set_fs(fs);
const env = { today: TODAY };

const mug = (o: Partial<Item> = {}): Item => ({
  rowId: "r1", sku: "MUG-01", description: "Ceramic coffee mug, 350 ml", hsCode: "691200", quantity: 1080, unitPrice: 5,
  unitsPerCarton: 12, cartons: 90, unitWeight: 0.5, countryOfOrigin: "United Kingdom", ...o,
});
const booking = (o: Partial<Booking> = {}, items: Item[] = [mug()]): Booking => ({
  bookingId: "T-1", sellerName: "Test", originCity: "London", originCountry: "United Kingdom", destinationCity: "Berlin",
  destinationCountry: "Germany", destinationType: "Warehouse", readyDate: "2026-11-05", priority: "Cheapest", pallets: 3,
  cartons: 90, declaredValue: 5400, currency: "GBP", grossWeight: 620, appointmentBooked: true, items, ...o,
});
const status = (b: Booking, id: string, e: Env = env) => validateBooking(b, e).rules.find((r) => r.id === id)!.status;

describe("fixed data equals the template (Sheets 3 and 4)", () => {
  const wb = XLSX.readFile(path.resolve(__dirname, "../docs/template.xlsx"));
  const aoa = (s: string) => (XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1, raw: true, defval: null }) as unknown[][]).filter((r) => r.some((c) => c !== null && c !== ""));

  it("data/carriers.json equals Sheet 3 'Carrier options'", () => {
    const rows = aoa("Carrier options");
    const h = rows.findIndex((r) => r[0] === "Carrier");
    const sheet = rows.slice(h + 1).map((r) => ({
      carrier: r[0], service: r[1], originCountry: r[2], destinationCountry: r[3], pricePerPallet: r[4], currency: r[5],
      transitDays: r[6], onTimePct: r[7], maxKgPerPallet: r[8],
    }));
    expect(sheet.length).toBe(9);
    expect(carriers.carriers).toEqual(sheet);
  });

  it("data/rulebook.json equals Sheet 4 'Rulebook' and rulebook.ts has exactly these 10 rules", () => {
    const rows = aoa("Rulebook");
    const h = rows.findIndex((r) => r[0] === "Rule ID");
    const sheet = rows.slice(h + 1).map((r) => ({ id: r[0], text: r[1], severity: r[2] }));
    expect(rulebook.rules).toEqual(sheet);
    expect(RULES.map((r) => [r.id, r.severity, r.text])).toEqual(sheet.map((r) => [r.id, r.severity, r.text]));
  });
});

describe("rule edge cases", () => {
  it("clean booking is CLEAR TO SHIP", () => expect(validateBooking(booking(), env).verdict).toBe("CLEAR TO SHIP"));

  it("R-02 exactly 1% passes, just over fails (measured against the computed sum)", () => {
    expect(withinTolerance(5454, 5400)).toBe(true);
    expect(withinTolerance(5346, 5400)).toBe(true);
    expect(withinTolerance(5454.01, 5400)).toBe(false);
    expect(withinTolerance(5345.99, 5400)).toBe(false);
    expect(status(booking({ declaredValue: 5454 }), "R-02")).toBe("pass");
    expect(status(booking({ declaredValue: 5454.01 }), "R-02")).toBe("fail");
  });

  it("R-10: today passes, yesterday fails (Europe/London date injected)", () => {
    expect(status(booking({ readyDate: TODAY }), "R-10")).toBe("pass");
    expect(status(booking({ readyDate: addDays(TODAY, -1) }), "R-10")).toBe("fail");
    expect(status(booking({ readyDate: "2026-11-05" }), "R-10", { today: "2026-11-06" })).toBe("fail");
  });

  it("R-01: HS read as text; trailing .0 stripped; 5 digits Red with caveat; letters invalid", () => {
    expect(status(booking({}, [mug({ hsCode: "691200.0" })]), "R-01")).toBe("pass");
    expect(status(booking({}, [mug({ hsCode: "6912.00" })]), "R-01")).toBe("pass");
    expect(status(booking({}, [mug({ hsCode: null })]), "R-01")).toBe("fail");
    expect(status(booking({}, [mug({ hsCode: "69A200" })]), "R-01")).toBe("fail");
    const r = validateBooking(booking({}, [mug({ hsCode: "90121" })]), env).rules.find((x) => x.id === "R-01")!;
    expect(r.status).toBe("fail");
    expect(r.severity).toBe("Red");
    expect(r.caveat).toMatch(/gov\.uk\/trade-tariff/);
  });

  it("R-05 cap is inclusive (400 kg/pallet opens Carrier C)", () => {
    const c = evaluateCarriers(booking({ grossWeight: 1600, pallets: 4 }));
    expect(c.feasible).toEqual(["A", "B", "C"]);
    expect(evaluateCarriers(booking({ grossWeight: 1601, pallets: 4 })).feasible).toEqual(["A", "B"]);
  });

  it("R-06 implied stays Red until the seller declares; never Amber; audit line has no identity", () => {
    const b = booking({}, [mug({ description: "Bluetooth speaker, waterproof" })]);
    const res = validateBooking(b, env);
    const r06 = res.rules.find((r) => r.id === "R-06")!;
    expect([r06.severity, r06.status, r06.state, res.verdict]).toEqual(["Red", "fail", "implied", "BLOCKED"]);
    const confirmed = validateBooking({ ...b, items: [{ ...b.items[0], hazardConfirmedAt: "25-10-2026 14:03" }] }, env);
    const r06b = confirmed.rules.find((r) => r.id === "R-06")!;
    expect(r06b.status).toBe("pass");
    expect(r06b.numbers!.join(" ")).toBe("MUG-01: Confirmed by seller, 25-10-2026 14:03 (Europe/London)");
    for (const sev of RULES.filter((x) => x.id === "R-06")) expect(sev.severity).toBe("Red");
  });

  it("R-06 explicit beats a confirmation and the model can't downgrade it", () => {
    const b = booking({}, [mug({ description: "Hairspray aerosol 300ml", hazardConfirmedAt: "25-10-2026 10:00" })]);
    const res = validateBooking(b, { ...env, hazardHints: { r1: "none" } });
    expect(res.rules.find((r) => r.id === "R-06")!.state).toBe("explicit");
  });

  it("R-06 model hint can only ADD implied", () => {
    const b = booking({}, [mug({ description: "Rechargeable desk fan" })]);
    expect(status(b, "R-06")).toBe("pass");
    expect(status(b, "R-06", { ...env, hazardHints: { r1: "implied" } })).toBe("fail");
  });

  it("Local-only implied list covers the spec's examples", () => {
    for (const d of ["Wireless earbuds", "Bluetooth speaker", "Cordless vacuum cleaner", "Nail polish, red", "Hand sanitiser 500ml"]) {
      expect(validateBooking(booking({}, [mug({ description: d })]), env).hazards.r1.kind, d).toBe("implied");
    }
  });

  it("R-08 / R-09 / R-07 basics", () => {
    expect(status(booking({ destinationType: "Business address", appointmentBooked: false }), "R-08")).toBe("pass");
    expect(status(booking({ appointmentBooked: false }), "R-08")).toBe("fail");
    expect(status(booking({}, [mug({ countryOfOrigin: null })]), "R-09")).toBe("fail");
    expect(status(booking({ grossWeight: 540 }), "R-07")).toBe("pass");
    expect(status(booking({ grossWeight: 539.99 }), "R-07")).toBe("fail");
  });

  it("verdict precedence: Red > Incomplete > Amber > Clear", () => {
    expect(validateBooking(booking({ pallets: 0, declaredValue: 9999 }), env).verdict).toBe("BLOCKED");
    expect(validateBooking(booking({ pallets: 0, appointmentBooked: false }), env).verdict).toBe("INCOMPLETE");
    expect(validateBooking(booking({ appointmentBooked: false }), env).verdict).toBe("SHIP WITH CARE");
  });

  it("D-02: item missing a number is excluded, affected rules not checked, never Red", () => {
    const b = booking({}, [mug(), mug({ rowId: "r2", sku: "BWL-02", unitPrice: null })]);
    const res = validateBooking(b, env);
    expect(res.gate.map((g) => g.code)).toContain("D-02");
    expect(res.rules.find((r) => r.id === "R-02")!.status).toBe("not_checked");
    expect(res.verdict).not.toBe("CLEAR TO SHIP");
  });
});

describe("repair engine", () => {
  it("worked case: qty 1000, 12/carton, 90 cartons, £5, declared 5400 -> quantity 1080 High, both lines of arithmetic", () => {
    const res = validateBooking(booking({}, [mug({ quantity: 1000 })]), env);
    expect(res.rules.filter((r) => r.status === "fail").map((r) => r.id)).toEqual(["R-02", "R-03"]);
    const r = res.repairs[0];
    expect([r.stage, r.confidence, r.applyEnabled]).toEqual([1, "High", true]);
    expect(r.changes).toEqual([{ field: "item.quantity", rowId: "r1", sku: "MUG-01", from: 1000, to: 1080 }]);
    expect(r.arithmetic).toEqual(["MUG-01: 12 per carton × 90 cartons = 1,080 = quantity 1,080", "Sum of quantity × unit price = 1,080 × £5 = £5,400"]);
  });

  it("weight is never High: R-07 fix is a floor at Possible", () => {
    const r = validateBooking(booking({ grossWeight: 400 }), env).repairs[0];
    expect([r.confidence, r.applyEnabled, r.floor]).toEqual(["Possible", false, 540]);
    expect(r.message).toMatch(/at least 540 kg/);
  });

  it("Stage 3 reports separately and never guesses (no apply)", () => {
    const b = booking({ cartons: 150, declaredValue: 8760, grossWeight: 1000 }, [mug({ quantity: 1000 }), mug({ rowId: "r2", sku: "BWL-02", quantity: 480, unitPrice: 7, unitsPerCarton: 8, cartons: 55, unitWeight: 0.6 })]);
    const reps = validateBooking(b, env).repairs;
    expect(reps.length).toBe(4);
    for (const r of reps) expect([r.stage, r.confidence, r.applyEnabled, r.message.startsWith(STAGE3_MESSAGE)]).toEqual([3, "Possible", false, true]);
  });

  it("refuses to change trusted fields", () => {
    expect(() => applyChanges(booking(), [{ field: "item.unit_price" as never, rowId: "r1", from: 5, to: 6 }])).toThrow(/trusted/);
  });
});

describe("carriers and dates", () => {
  it("Balanced worked check: 3 pallets to Germany -> A 0.60, B 0.35, C 0.40 -> B", () => {
    const c = evaluateCarriers(booking({ priority: "Balanced", grossWeight: 600 }));
    expect(c.options.map((o) => o.totalCost)).toEqual([540, 660, 1020]);
    expect(Object.fromEntries(c.balanced.map((b) => [b.id, round2(b.score)]))).toEqual({ A: 0.6, B: 0.35, C: 0.4 });
    expect(c.recommended).toBe("B");
  });

  it("max == min term is 0; single feasible carrier scores 0", () => {
    const c = evaluateCarriers(booking({ priority: "Balanced", grossWeight: 1600, pallets: 3 }));
    expect(c.feasible).toEqual(["B"]);
    expect(c.balanced).toEqual([{ id: "B", costN: 0, transitN: 0, reliabilityN: 0, score: 0 }]);
  });

  it("ranking modes and tie-breaks", () => {
    const c = evaluateCarriers(booking({ grossWeight: 600 }));
    const opts = c.options;
    const w = c.weights;
    expect(rank(opts, "Cheapest", w)[0].id).toBe("A");
    expect(rank(opts, "Fastest", w)[0].id).toBe("C");
    expect(rank(opts, "Most reliable", w)[0].id).toBe("C");
    expect(balancedScores(opts, { cost: 1, transit: 0, reliability: 0 }).find((r) => r.id === "A")!.score).toBe(0);
    expect(rank(opts, "Balanced", { cost: 0, transit: 1, reliability: 0 })[0].id).toBe("C");
  });

  it("weekend and weekday dates", () => {
    expect(collectionDate("2026-11-07")).toBe("2026-11-09");
    expect(etaDate("2026-11-09", 5)).toBe("2026-11-16");
    expect(etaDate(collectionDate("2026-11-05"), 5)).toBe("2026-11-10");
    expect(collectionDate("2026-11-08")).toBe("2026-11-09");
  });

  it("Demo 1 flip: 2 -> 3 -> 4 pallets", () => {
    const d1 = (p: number) => evaluateCarriers(booking({ grossWeight: 1600, pallets: p, priority: "Balanced", destinationCity: "Hamburg" }));
    expect([d1(2).r05, d1(2).feasible]).toEqual(["no_carrier_fits", []]);
    expect(d1(2).minPallets).toEqual({ A: 4, B: 3, C: 4 });
    expect([d1(3).feasible, d1(3).chosen, d1(3).options.find((o) => o.id === "B")!.totalCost]).toEqual([["B"], "B", 660]);
    expect(d1(4).feasible).toEqual(["A", "B", "C"]);
  });

  it("Demo 2: 3 pallets -> B £660, 4 pallets -> C £1,360", () => {
    const d2 = (p: number) => evaluateCarriers(booking({ grossWeight: 1260, pallets: p, priority: "Fastest" }));
    expect([d2(3).feasible, d2(3).chosen]).toEqual([["A", "B"], "B"]);
    expect([d2(4).chosen, d2(4).options.find((o) => o.id === "C")!.totalCost]).toEqual(["C", 1360]);
  });
});

describe("invariant: no value the app suggests may fail a rule", () => {
  const variants: Booking[] = [];
  // deterministic perturbations of the clean booking and a two-item booking
  const two = () => booking({ cartons: 150, declaredValue: 8760, grossWeight: 1000 }, [mug(), mug({ rowId: "r2", sku: "BWL-02", quantity: 480, unitPrice: 7, unitsPerCarton: 8, cartons: 60, unitWeight: 0.6 })]);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  for (let k = 0; k < 400; k++) {
    const b = rnd() < 0.5 ? booking() : two();
    const n = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < n; j++) {
      const it = pick(b.items);
      const f = pick(["declaredValue", "cartons", "grossWeight", "pallets", "qty", "icartons"]);
      const m = pick([0.5, 0.9, 1.1, 1.2, 2, 3]);
      if (f === "qty") it.quantity = Math.round(it.quantity! * m);
      else if (f === "icartons") it.cartons = Math.max(1, Math.round(it.cartons! * m));
      else if (f === "pallets") b.pallets = Math.max(1, Math.round(b.pallets! * m));
      else (b as unknown as Record<string, number>)[f] = Math.round((b as unknown as Record<string, number>)[f] * m);
    }
    variants.push(b);
  }

  it(`${variants.length} perturbed bookings: every Stage 1/2 suggestion and seller action clears its target and breaks nothing`, () => {
    let checked = 0;
    for (const b of variants) {
      const res = validateBooking(b, env);
      const failsBefore = new Set(res.rules.filter((r) => r.status === "fail").map((r) => r.id));
      const sets = res.repairs.filter((r) => r.stage === 1 || r.stage === 2).flatMap((r) => (r.options ?? [r.changes]).map((cs) => ({ cs, rules: r.rules })));
      for (const { cs, rules } of sets) {
        if (!cs.length) continue;
        const after = validateBooking(applyChanges(b, cs), env).rules;
        for (const id of rules) expect(after.find((r) => r.id === id)!.status, `${id} after ${JSON.stringify(cs)}`).toBe("pass");
        for (const r of after) if (r.status === "fail") expect(failsBefore.has(r.id), `${r.id} newly broken by ${JSON.stringify(cs)}`).toBe(true);
        checked++;
      }
      for (const a of sellerActions(b, res.rules, buildContext(b, env))) {
        let b2 = a.changes ? applyChanges(b, a.changes) : b;
        if (a.setCarrier !== undefined) b2 = { ...b2, chosenCarrier: a.setCarrier };
        if (a.setAppointment !== undefined) b2 = { ...b2, appointmentBooked: a.setAppointment };
        const after = validateBooking(b2, env).rules;
        for (const id of a.rules) expect(after.find((r) => r.id === id)!.status).toBe("pass");
        for (const r of after) if (r.status === "fail") expect(failsBefore.has(r.id)).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });
});

describe("clock injection", () => {
  it("no rule/carrier/engine module reads the clock", () => {
    for (const f of ["rulebook.ts", "carrier.ts", "validate.ts", "repair.ts", "context.ts", "explain.ts", "changelog.ts", "trust.ts", "hazards.ts", "config.ts"]) {
      const src = fs.readFileSync(path.resolve(__dirname, "../lib", f), "utf8");
      expect(src, f).not.toMatch(/Date\.now\(|new Date\(/);
    }
    expect(fs.readFileSync(path.resolve(__dirname, "../lib/dates.ts"), "utf8")).not.toMatch(/Date\.now\(/);
  });
});

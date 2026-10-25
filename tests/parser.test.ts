import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWorkbook } from "@/lib/parse";
import { validateWorkbook } from "@/lib/validate";
import { expected, FIXTURES, loadFixture, TODAY } from "./helpers/loadFixture";

const env = { today: TODAY };
const BH = ["Booking ID", "Seller name", "Origin city", "Origin country", "Destination city", "Destination country", "Destination type", "Ready to ship date", "Seller priority", "Pallets", "Cartons", "Total declared value", "Currency", "Total gross weight (kg)", "Delivery appointment booked"];
const IH = ["Booking ID", "SKU", "Description", "HS code", "Quantity (units)", "Unit price", "Units per carton", "Cartons", "Unit weight (kg)", "Country of origin"];
const EXB = ["BK-001", "Northfield Goods", "Manchester", "United Kingdom", "Frankfurt", "Germany", "Warehouse", "05-11-2026", "Cheapest", 3, 90, 5400, "GBP", 620, "Yes"];
const EXI = ["BK-001", "MUG-01", "Ceramic coffee mug, 350 ml", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"];
const bRow = (id: string, o: Partial<Record<string, unknown>> = {}) => BH.map((h, j) => (h in o ? o[h] : h === "Booking ID" ? id : EXB[j]));
const iRow = (id: string, o: Partial<Record<string, unknown>> = {}) => IH.map((h, j) => (h in o ? o[h] : h === "Booking ID" ? id : EXI[j]));

function book(b: unknown[][], i: unknown[][], opts: { headerOffset?: number; order?: number[]; iorder?: number[] } = {}) {
  const pad = Array.from({ length: opts.headerOffset ?? 0 }, () => []);
  const reorder = (rows: unknown[][], ord?: number[]) => (ord ? rows.map((r) => ord.map((k) => r[k])) : rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Bookings — one row per record."], ...pad, ...reorder([BH, EXB, ...b], opts.order)]), "Bookings");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Items — one row per record."], ...pad, ...reorder([IH, EXI, ...i], opts.iorder)]), "Items");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
const run = (buf: ArrayBuffer) => validateWorkbook(parseWorkbook(buf), env);
const readFile = (f: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, f)));

describe("official template layout (all 22 fixtures)", () => {
  for (const fx of expected.fixtures) {
    it(`${fx.file}: reconciliation "${fx.reconciliation}" and same bookings as the test loader`, () => {
      const parsed = parseWorkbook(readFile(fx.file));
      const out = validateWorkbook(parsed, env);
      expect(out.reconciliation.line).toBe(fx.reconciliation);
      expect(parsed.exampleRowsSkipped).toBe(2);
      const ref = loadFixture(fx.file);
      expect(parsed.orphans.map(({ bookingId, sku, row }) => ({ bookingId, sku, row }))).toEqual(ref.orphans);
      const strip = (b: { items: { rowId: string; quarantined?: unknown }[]; quarantined?: unknown }) => ({ ...b, quarantined: undefined, items: b.items.map((i) => ({ ...i, rowId: undefined, quarantined: undefined })) });
      expect(parsed.bookings.map(strip)).toEqual(ref.bookings.map(strip));
      for (const eb of fx.bookings) expect(out.results.find((r) => r.booking.bookingId === eb.bookingId)!.verdict).toBe(eb.verdict);
    });
  }

  it("the blank template itself: only the example row -> nothing read, no crash", () => {
    const out = run(fs.readFileSync(path.resolve(__dirname, "../docs/template.xlsx")).buffer as ArrayBuffer);
    expect(out.reconciliation.line).toBe("0 rows read, 0 validated, 0 unmatched, 0 incomplete");
  });
});

describe("odd layouts", () => {
  const b = [bRow("BK-101"), bRow("BK-102", { "Total declared value": 6000 })];
  const i = [iRow("BK-101"), iRow("BK-102")];

  it("header moved down two rows", () => {
    const out = run(book(b, i, { headerOffset: 2 }));
    expect(out.reconciliation.line).toBe("4 rows read, 4 validated, 0 unmatched, 0 incomplete");
    expect(out.results.map((r) => r.verdict)).toEqual(["CLEAR TO SHIP", "BLOCKED"]);
  });

  it("reordered columns (found by name, not position)", () => {
    const order = [14, 3, 0, 9, 13, 7, 1, 12, 2, 11, 4, 10, 5, 8, 6];
    const iorder = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const out = run(book(b, i, { order, iorder }));
    expect(out.reconciliation.line).toBe("4 rows read, 4 validated, 0 unmatched, 0 incomplete");
    expect(out.results.map((r) => r.verdict)).toEqual(["CLEAR TO SHIP", "BLOCKED"]);
    expect(out.results[1].rules.find((r) => r.id === "R-02")!.status).toBe("fail");
  });

  it("a corrupt row is quarantined (D-06), never crashes, every row accounted for", () => {
    const bad = [
      bRow("BK-201"),
      bRow("BK-202", { Pallets: "two", "Total gross weight (kg)": -5, "Ready to ship date": "31-02-2026" }),
    ];
    const items = [iRow("BK-201"), iRow("BK-202", { "Quantity (units)": "abc" }), iRow("BK-999")];
    const out = run(book(bad, items));
    expect(out.reconciliation.line).toBe("5 rows read, 2 validated, 1 unmatched, 2 incomplete");
    const r = out.results[1];
    expect(r.gate.filter((g) => g.code === "D-06").map((g) => g.field).sort()).toEqual(["Pallets", "Ready to ship date", "Total gross weight (kg)", "quantity"]);
    expect(r.verdict).toBe("INCOMPLETE");
    expect(r.rules.find((x) => x.id === "R-05")!.status).toBe("cannot_compute");
  });

  it("blank rows, extra whitespace, HS as number/text, lost leading zero, Excel date serial", () => {
    const ws = [
      bRow("  BK-301  ", { "Destination city": "  berlin ", "Ready to ship date": 46331 /* 05-11-2026 */ }),
      [],
      bRow("BK-302", { "Destination type": "warehouse ", "Delivery appointment booked": " yes" }),
    ];
    const items = [iRow("BK-301", { "HS code": "691200.0" }), [], iRow("bk-302", { "HS code": 90121 })];
    const parsed = parseWorkbook(book(ws, items));
    expect(parsed.bookings.map((x) => [x.bookingId, x.destinationCity, x.readyDate])).toEqual([["BK-301", "Berlin", "2026-11-05"], ["BK-302", "Frankfurt", "2026-11-05"]]);
    const out = validateWorkbook(parsed, env);
    expect(out.reconciliation.line).toBe("4 rows read, 4 validated, 0 unmatched, 0 incomplete");
    expect(out.results[0].rules.find((r) => r.id === "R-01")!.status).toBe("pass");
    const r01 = out.results[1].rules.find((r) => r.id === "R-01")!;
    expect([r01.status, Boolean(r01.caveat)]).toEqual(["fail", true]);
    expect(out.results[1].booking.destinationType).toBe("Warehouse");
    expect(out.results[1].booking.appointmentBooked).toBe(true);
  });

  it("duplicate Booking IDs: both shown and flagged (D-04)", () => {
    const out = run(book([bRow("BK-401"), bRow("BK-401", { Pallets: 4 })], [iRow("BK-401")]));
    expect(out.results.length).toBe(2);
    for (const r of out.results) expect(r.gate.map((g) => g.code)).toContain("D-04");
    expect(out.reconciliation.line).toBe("3 rows read, 1 validated, 0 unmatched, 0 incomplete, 2 duplicate");
  });

  it("not an xlsx at all -> a friendly note, no crash", () => {
    const parsed = parseWorkbook(new TextEncoder().encode("hello, not a workbook"));
    expect(parsed.bookings).toEqual([]);
    expect(validateWorkbook(parsed, env).reconciliation.rowsRead).toBe(0);
  });

  it("1 booking", () => {
    expect(run(book([bRow("BK-501")], [iRow("BK-501")])).reconciliation.line).toBe("2 rows read, 2 validated, 0 unmatched, 0 incomplete");
  });

  it("50 bookings validate in under 2 seconds", () => {
    const bs: unknown[][] = [];
    const is: unknown[][] = [];
    const cities = ["Berlin", "Frankfurt", "Hamburg", "Paris", "Lyon", "Amsterdam", "Rotterdam"];
    const pr = ["Cheapest", "Fastest", "Most reliable", "Balanced"];
    for (let k = 1; k <= 50; k++) {
      const id = `BK-${String(k).padStart(3, "0")}-X`;
      const city = cities[k % cities.length];
      const country = { Berlin: "Germany", Frankfurt: "Germany", Hamburg: "Germany", Paris: "France", Lyon: "France", Amsterdam: "Netherlands", Rotterdam: "Netherlands" }[city];
      // every 5th booking gets a planted mistake (two items, one with a wrong quantity)
      bs.push(bRow(id, { "Destination city": city, "Destination country": country, "Seller priority": pr[k % 4], Cartons: 150, "Total declared value": 8760, "Total gross weight (kg)": 1000 }));
      is.push(iRow(id, k % 5 === 0 ? { "Quantity (units)": 1000 } : {}));
      is.push(iRow(id, { SKU: "BWL-02", Description: "Ceramic bowl", "Quantity (units)": 480, "Unit price": 7, "Units per carton": 8, Cartons: 60, "Unit weight (kg)": 0.6 }));
    }
    const buf = book(bs, is);
    const t0 = performance.now();
    const out = run(buf);
    const ms = performance.now() - t0;
    expect(out.reconciliation.line).toBe("150 rows read, 150 validated, 0 unmatched, 0 incomplete");
    expect(out.results.filter((r) => r.verdict === "BLOCKED").length).toBe(10);
    expect(out.results.filter((r) => r.verdict === "CLEAR TO SHIP").length).toBe(40);
    expect(ms).toBeLessThan(2000);
    console.log(`50-booking file parsed + validated in ${ms.toFixed(0)} ms`);
  });
});

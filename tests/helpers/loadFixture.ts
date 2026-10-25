// Test-only loader (Phase 2): reads a fixture workbook straight into engine Bookings
// so engine tests don't depend on lib/parse.ts. Phase 3 asserts parse.ts agrees with it.
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";
import { carrierId } from "@/lib/carrier";
import { cityCountry, normaliseCountry } from "@/lib/config";
import { parseDDMMYYYY } from "@/lib/dates";
import type { Booking, DestinationType, Item, Priority } from "@/lib/types";

XLSX.set_fs(fs);
export const FIXTURES = path.resolve(__dirname, "../../fixtures");
export const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, "expected.json"), "utf8"));
export const TODAY = expected.today as string;

function rows(wb: XLSX.WorkBook, sheet: string) {
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: null });
  const h = aoa.findIndex((r) => r.some((c) => String(c ?? "").trim() === "Booking ID"));
  const head = aoa[h].map((c) => String(c ?? "").trim());
  return aoa.slice(h + 2).map((r, k) => ({ row: h + 3 + k, r })).filter(({ r }) => r.some((c) => c !== null && String(c).trim() !== ""))
    .map(({ row, r }) => ({ row, get: (name: string) => { const v = r[head.indexOf(name)]; return v === null || v === undefined || String(v).trim() === "" ? null : v; } }));
}
const n = (v: unknown) => (v === null ? null : Number(v));
const s = (v: unknown) => (v === null ? null : String(v).trim());

export function loadFixture(file: string): { bookings: Booking[]; orphans: { bookingId: string; sku: string; row: number }[] } {
  const wb = XLSX.readFile(path.join(FIXTURES, file));
  const B = rows(wb, "Bookings");
  const I = rows(wb, "Items");
  const bookings: Booking[] = B.map(({ row, get }) => ({
    bookingId: s(get("Booking ID"))!, row, sellerName: s(get("Seller name")), originCity: s(get("Origin city")),
    originCountry: normaliseCountry(s(get("Origin country"))), destinationCity: s(get("Destination city")),
    destinationCountry: normaliseCountry(s(get("Destination country"))) ?? cityCountry(s(get("Destination city"))),
    destinationType: s(get("Destination type")) as DestinationType | null, readyDate: parseDDMMYYYY(s(get("Ready to ship date")) ?? ""),
    priority: s(get("Seller priority")) as Priority | null, pallets: n(get("Pallets")), cartons: n(get("Cartons")),
    declaredValue: n(get("Total declared value")), currency: s(get("Currency")), grossWeight: n(get("Total gross weight (kg)")),
    appointmentBooked: s(get("Delivery appointment booked")) === null ? null : s(get("Delivery appointment booked")) === "Yes",
    chosenCarrier: get("Chosen carrier") ? carrierId(String(get("Chosen carrier"))) : null, items: [],
  }));
  const orphans: { bookingId: string; sku: string; row: number }[] = [];
  for (const { row, get } of I) {
    const item: Item = {
      rowId: `r${row}`, row, sku: s(get("SKU")) ?? "", description: s(get("Description")) ?? "", hsCode: s(get("HS code")),
      quantity: n(get("Quantity (units)")), unitPrice: n(get("Unit price")), unitsPerCarton: n(get("Units per carton")),
      cartons: n(get("Cartons")), unitWeight: n(get("Unit weight (kg)")), countryOfOrigin: normaliseCountry(s(get("Country of origin"))),
    };
    const b = bookings.find((x) => x.bookingId === s(get("Booking ID")));
    if (b) b.items.push(item); else orphans.push({ bookingId: s(get("Booking ID"))!, sku: item.sku, row });
  }
  return { bookings, orphans };
}

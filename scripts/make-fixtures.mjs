// Generates the file-based fixtures in the official template structure.
// Each fixture = docs/template.xlsx with rows 4+ of Bookings and Items filled in
// (title row 1, header row 2, grey example row 3 untouched; Sheets 3-7 untouched).
// Run: node scripts/make-fixtures.mjs
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

XLSX.set_fs(fs);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const TEMPLATE = path.join(root, "docs", "template.xlsx");
const OUT = path.join(root, "fixtures");

const BOOKING_HEADERS = ["Booking ID", "Seller name", "Origin city", "Origin country", "Destination city",
  "Destination country", "Destination type", "Ready to ship date", "Seller priority", "Pallets", "Cartons",
  "Total declared value", "Currency", "Total gross weight (kg)", "Delivery appointment booked"];

// Clean base booking (fixture 17): 1080 mugs, 90 cartons, GBP 5,400, 620 kg on 3 pallets to Berlin.
const baseBooking = (id, o = {}) => ({
  id, seller: "Northfield Goods", originCity: "London", originCountry: "United Kingdom",
  destCity: "Berlin", destCountry: "Germany", destType: "Warehouse", ready: "05-11-2026",
  priority: "Cheapest", pallets: 3, cartons: 90, value: 5400, currency: "GBP", gross: 620, appt: "Yes", ...o,
});
const mug = (id, o = {}) => ({
  id, sku: "MUG-01", desc: "Ceramic coffee mug, 350 ml", hs: 691200, qty: 1080, price: 5, upc: 12,
  cartons: 90, uw: 0.5, origin: "United Kingdom", ...o,
});

const bRow = (b) => [b.id, b.seller, b.originCity, b.originCountry, b.destCity, b.destCountry, b.destType,
  b.ready, b.priority, b.pallets, b.cartons, b.value, b.currency, b.gross, b.appt];
const iRow = (i) => [i.id, i.sku, i.desc, i.hs, i.qty, i.price, i.upc, i.cartons, i.uw, i.origin];

const fixtures = [
  { file: "f01-r01-hs-code.xlsx", bookings: [baseBooking("F01", { cartons: 20, value: 2880, gross: 300, pallets: 1 })],
    items: [{ id: "F01", sku: "COF-1KG", desc: "Roasted coffee beans, 1 kg bag", hs: 90121, qty: 240, price: 12, upc: 12, cartons: 20, uw: 1.05, origin: "Vietnam" }] },
  { file: "f02-r02-declared-value.xlsx", bookings: [baseBooking("F02", { value: 5600 })], items: [mug("F02")] },
  { file: "f03-r03-carton-maths.xlsx", bookings: [baseBooking("F03", { cartons: 12, value: 800, gross: 40, pallets: 1 })],
    items: [{ id: "F03", sku: "TOTE-01", desc: "Cotton tote bag", hs: 420222, qty: 100, price: 8, upc: 10, cartons: 12, uw: 0.2, origin: "India" }] },
  { file: "f04-r04-booking-cartons.xlsx", bookings: [baseBooking("F04", { cartons: 95 })], items: [mug("F04")] },
  { file: "f05-r05-weight-per-pallet.xlsx", bookings: [baseBooking("F05", { gross: 2400 })], items: [mug("F05")] },
  { file: "f06-r06-explicit-hazard.xlsx", bookings: [baseBooking("F06", { cartons: 10, value: 3000, gross: 80, pallets: 1 })],
    items: [{ id: "F06", sku: "PWR-10", desc: "Portable power bank, lithium-ion battery 10000mAh", hs: 850760, qty: 200, price: 15, upc: 20, cartons: 10, uw: 0.25, origin: "China" }] },
  { file: "f06i-r06-implied-hazard.xlsx", bookings: [baseBooking("F06I", { cartons: 12, value: 6000, gross: 60, pallets: 1 })],
    items: [{ id: "F06I", sku: "EAR-01", desc: "Wireless earbuds with charging case", hs: 851830, qty: 300, price: 20, upc: 25, cartons: 12, uw: 0.1, origin: "China" }] },
  { file: "f07-r07-gross-weight.xlsx", bookings: [baseBooking("F07", { gross: 500 })], items: [mug("F07")] },
  { file: "f08-r08-appointment.xlsx", bookings: [baseBooking("F08", { appt: "No" })], items: [mug("F08")] },
  { file: "f09-r09-country-of-origin.xlsx", bookings: [baseBooking("F09")], items: [mug("F09", { origin: "" })] },
  { file: "f10-r10-past-date.xlsx", bookings: [baseBooking("F10", { ready: "20-10-2026" })], items: [mug("F10")] },
  // 11: declared value AND quantity both wrong -> unique Stage 2 pair (DV 5400, qty 1080)
  { file: "f11-two-mistakes-pair.xlsx", bookings: [baseBooking("F11", { value: 5600 })], items: [mug("F11", { qty: 1000 })] },
  // 12: two item-level mistakes (MUG qty, BWL cartons) -> Stage 3 honest fallback
  { file: "f12-two-mistakes-fallback.xlsx", bookings: [baseBooking("F12", { cartons: 150, value: 8760, gross: 1000 })],
    items: [mug("F12", { qty: 1000 }), { id: "F12", sku: "BWL-02", desc: "Ceramic bowl, 15 cm", hs: 691200, qty: 480, price: 7, upc: 8, cartons: 55, uw: 0.6, origin: "United Kingdom" }] },
  // 13: two independent mistakes (booking cartons; gross under goods weight) -> separate repairs
  { file: "f13-two-mistakes-independent.xlsx", bookings: [baseBooking("F13", { cartons: 96, gross: 500 })], items: [mug("F13")] },
  { file: "f14-zero-items.xlsx", bookings: [baseBooking("F14", { cartons: 10, value: 1000, gross: 300, pallets: 1 })], items: [] },
  { file: "f15-orphan-item.xlsx", bookings: [baseBooking("F15")],
    items: [mug("F15"), { id: "BK-999", sku: "LMP-03", desc: "Desk lamp shade, linen", hs: 940599, qty: 50, price: 11, upc: 5, cartons: 10, uw: 0.4, origin: "China" }] },
  { file: "f16-zero-pallets.xlsx", bookings: [baseBooking("F16", { pallets: 0 })], items: [mug("F16")] },
  { file: "f17-clean.xlsx", bookings: [baseBooking("F17")], items: [mug("F17")] },
  { file: "f18-demo1.xlsx", bookings: [baseBooking("DEMO-1", { seller: "Ironleaf Kitchen", originCity: "Birmingham", destCity: "Hamburg", ready: "02-11-2026", priority: "Balanced", pallets: 2, cartons: 100, value: 10800, gross: 1600 })],
    items: [{ id: "DEMO-1", sku: "SKL-26", desc: "Cast iron skillet, 26 cm", hs: 732393, qty: 600, price: 18, upc: 6, cartons: 100, uw: 2.3, origin: "China" }] },
  { file: "f19-demo2.xlsx", bookings: [baseBooking("DEMO-2", { seller: "Oak & Grain", originCity: "Leeds", destCity: "Frankfurt", ready: "02-11-2026", priority: "Fastest", pallets: 3, cartons: 120, value: 10800, gross: 1260 })],
    items: [{ id: "DEMO-2", sku: "CHB-40", desc: "Wooden chopping board, 40 cm", hs: 441990, qty: 1200, price: 9, upc: 10, cartons: 120, uw: 0.95, origin: "Vietnam" }] },
  { file: "f20-seller-override.xlsx", extraBookingCols: { "Chosen carrier": ["Carrier C"] },
    bookings: [baseBooking("F20", { seller: "Clearview Home", originCity: "Manchester", destCity: "Paris", destCountry: "France", destType: "Business address", appt: "No", ready: "02-11-2026", priority: "Fastest", pallets: 3, cartons: 100, value: 7000, gross: 1500 })],
    items: [{ id: "F20", sku: "JAR-1L", desc: "Glass storage jar, 1 litre", hs: 701349, qty: 2000, price: 3.5, upc: 20, cartons: 100, uw: 0.6, origin: "Turkey" }] },
  { file: "f21-weekend-ready.xlsx", bookings: [baseBooking("F21", { ready: "07-11-2026" })], items: [mug("F21")] },
];

fs.mkdirSync(OUT, { recursive: true });
for (const fx of fixtures) {
  const wb = XLSX.readFile(TEMPLATE);
  const wsB = wb.Sheets["Bookings"];
  const wsI = wb.Sheets["Items"];
  const extra = fx.extraBookingCols ?? {};
  const extraNames = Object.keys(extra);
  if (extraNames.length) XLSX.utils.sheet_add_aoa(wsB, [extraNames], { origin: { r: 1, c: BOOKING_HEADERS.length } });
  const bRows = fx.bookings.map((b, i) => [...bRow(b), ...extraNames.map((n) => extra[n][i] ?? "")]);
  if (bRows.length) XLSX.utils.sheet_add_aoa(wsB, bRows, { origin: "A4" });
  if (fx.items.length) XLSX.utils.sheet_add_aoa(wsI, fx.items.map(iRow), { origin: "A4" });
  XLSX.writeFile(wb, path.join(OUT, fx.file));
  console.log("wrote", fx.file, `(${fx.bookings.length} booking rows, ${fx.items.length} item rows)`);
}

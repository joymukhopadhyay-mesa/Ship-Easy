// Builds public/sample-bookings.xlsx: one workbook in the official template structure
// with several bookings, some with planted mistakes (for the "Load sample file" button).
// Run: node scripts/make-sample.mjs
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

XLSX.set_fs(fs);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const wb = XLSX.readFile(path.join(root, "docs", "template.xlsx"));

const B = [
  // id, seller, origin, originCountry, destCity, destCountry, type, ready, priority, pallets, cartons, value, currency, gross, appt
  ["BK-101", "Northfield Goods", "Manchester", "United Kingdom", "Frankfurt", "Germany", "Warehouse", "05-11-2026", "Cheapest", 3, 90, 5400, "GBP", 620, "Yes"],
  ["BK-102", "Northfield Goods", "Manchester", "United Kingdom", "Berlin", "Germany", "Warehouse", "05-11-2026", "Balanced", 3, 90, 5600, "GBP", 620, "Yes"],
  ["BK-103", "Ironleaf Kitchen", "Birmingham", "United Kingdom", "Hamburg", "Germany", "Warehouse", "02-11-2026", "Balanced", 2, 100, 10800, "GBP", 1600, "Yes"],
  ["BK-104", "Oak & Grain", "Leeds", "United Kingdom", "Rotterdam", "Netherlands", "Warehouse", "06-11-2026", "Fastest", 2, 150, 8760, "GBP", 1000, "No"],
  ["BK-105", "Soundwave Ltd", "London", "United Kingdom", "Paris", "France", "Business address", "04-11-2026", "Most reliable", 1, 12, 6000, "GBP", 60, "No"],
  ["BK-106", "Bean There", "London", "United Kingdom", "Lyon", "France", "Business address", "07-11-2026", "Cheapest", 1, 20, 2880, "GBP", 300, "No"],
  ["BK-107", "Clearview Home", "Manchester", "United Kingdom", "Amsterdam", "Netherlands", "Warehouse", "20-10-2026", "Cheapest", 3, 96, 5400, "GBP", 500, "Yes"],
  ["BK-108", "Tote & Co", "Leeds", "United Kingdom", "Paris", "France", "Business address", "09-11-2026", "Balanced", 1, 12, 800, "GBP", 40, "No"],
  ["BK-109", "Northfield Goods", "London", "United Kingdom", "Berlin", "Germany", "Warehouse", "05-11-2026", "Cheapest", 0, 90, 5400, "GBP", 620, "Yes"],
  ["BK-111", "Northfield Goods", "London", "United Kingdom", "Frankfurt", "Germany", "Warehouse", "05-11-2026", "Most reliable", 3, 90, 5400, "GBP", 620, "No"],
  ["BK-110", "Empty Shelf Ltd", "London", "United Kingdom", "Hamburg", "Germany", "Warehouse", "05-11-2026", "Cheapest", 1, 10, 1000, "GBP", 300, "Yes"],
];
const I = [
  ["BK-101", "MUG-01", "Ceramic coffee mug, 350 ml", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"],
  ["BK-102", "MUG-01", "Ceramic coffee mug, 350 ml", 691200, 1000, 5, 12, 90, 0.5, "United Kingdom"],
  ["BK-103", "SKL-26", "Cast iron skillet, 26 cm", 732393, 600, 18, 6, 100, 2.3, "China"],
  ["BK-104", "MUG-01", "Ceramic coffee mug, 350 ml", 691200, 1000, 5, 12, 90, 0.5, "United Kingdom"],
  ["BK-104", "BWL-02", "Ceramic bowl, 15 cm", 691200, 480, 7, 8, 55, 0.6, "United Kingdom"],
  ["BK-105", "EAR-01", "Wireless earbuds with charging case", 851830, 300, 20, 25, 12, 0.1, "China"],
  ["BK-106", "COF-1KG", "Roasted coffee beans, 1 kg bag", 90121, 240, 12, 12, 20, 1.05, "Vietnam"],
  ["BK-107", "MUG-01", "Ceramic coffee mug, 350 ml", 691200, 1080, 5, 12, 90, 0.5, ""],
  ["BK-108", "TOTE-01", "Cotton tote bag", 420222, 100, 8, 10, 12, 0.2, "India"],
  ["BK-109", "MUG-01", "Ceramic coffee mug, 350 ml", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"],
  ["BK-111", "MUG-01", "Ceramic coffee mug, 350 ml", 691200, 1080, 5, 12, 90, 0.5, "United Kingdom"],
  ["BK-999", "LMP-03", "Desk lamp shade, linen", 940599, 50, 11, 5, 10, 0.4, "China"],
];
XLSX.utils.sheet_add_aoa(wb.Sheets["Bookings"], B, { origin: "A4" });
XLSX.utils.sheet_add_aoa(wb.Sheets["Items"], I, { origin: "A4" });
fs.mkdirSync(path.join(root, "public"), { recursive: true });
XLSX.writeFile(wb, path.join(root, "public", "sample-bookings.xlsx"));
fs.copyFileSync(path.join(root, "docs", "template.xlsx"), path.join(root, "public", "template.xlsx"));
console.log("wrote public/sample-bookings.xlsx and public/template.xlsx");

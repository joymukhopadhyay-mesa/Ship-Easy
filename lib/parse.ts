// Workbook parser. Finds sheets and header rows BY NAME (never by position), skips the
// template's grey example row by content, tolerates blank rows / extra whitespace / any
// column order, reads HS codes as text, parses DD-MM-YYYY, quarantines bad numbers (D-06),
// links Items to Bookings, and surfaces orphans (D-03) and duplicates (D-04). Never throws.
import * as XLSX from "xlsx";
import { carrierId } from "./carrier";
import { canonicalCity, cityCountry, DESTINATION_CITIES, normaliseCountry, ORIGIN_CITIES, PRIORITIES } from "./config";
import { isIsoDate, parseDDMMYYYY } from "./dates";
import type { Booking, DestinationType, Item, Priority, Quarantine } from "./types";

type Cell = string | number | boolean | Date | null;

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

const BOOKING_COLS = {
  bookingId: ["booking id", "booking", "booking ref", "booking reference"],
  sellerName: ["seller name", "seller"],
  originCity: ["origin city"],
  originCountry: ["origin country"],
  destinationCity: ["destination city"],
  destinationCountry: ["destination country"],
  destinationType: ["destination type"],
  readyDate: ["ready to ship date", "ready date", "ready to ship"],
  priority: ["seller priority", "priority"],
  pallets: ["pallets", "number of pallets"],
  cartons: ["cartons", "total cartons"],
  declaredValue: ["total declared value", "declared value"],
  currency: ["currency"],
  grossWeight: ["total gross weight", "gross weight", "total gross weight kg"],
  appointmentBooked: ["delivery appointment booked", "delivery appointment", "appointment booked"],
  chosenCarrier: ["chosen carrier", "carrier override", "selected carrier"],
} as const;

const ITEM_COLS = {
  bookingId: ["booking id", "booking", "booking ref", "booking reference"],
  sku: ["sku"],
  description: ["description", "item description"],
  hsCode: ["hs code", "hs", "commodity code"],
  quantity: ["quantity", "quantity units", "qty"],
  unitPrice: ["unit price", "price"],
  unitsPerCarton: ["units per carton"],
  cartons: ["cartons", "item cartons"],
  unitWeight: ["unit weight", "unit weight kg"],
  countryOfOrigin: ["country of origin", "origin"],
} as const;

const NUMERIC_LABEL: Record<string, string> = {
  pallets: "Pallets", cartons: "Cartons", declaredValue: "Total declared value", grossWeight: "Total gross weight (kg)",
  quantity: "quantity", unitPrice: "unit price", unitsPerCarton: "units per carton", unitWeight: "unit weight",
};

const EXAMPLE_BOOKING = ["bk-001", "northfield goods", "manchester", "united kingdom", "frankfurt", "germany", "warehouse"];
const EXAMPLE_ITEM = ["bk-001", "mug-01", "ceramic coffee mug, 350 ml"];

export interface OrphanRow {
  row: number;
  bookingId: string;
  sku: string;
  description: string;
}

export interface ParsedWorkbook {
  bookings: Booking[];
  orphans: OrphanRow[];
  bookingRowsRead: number;
  itemRowsRead: number;
  exampleRowsSkipped: number;
  notes: string[];
}

interface Table {
  rows: { row: number; get: (key: string) => Cell }[];
  found: string[];
  exampleSkipped: boolean;
}

function findTable(ws: XLSX.WorkSheet | undefined, spec: Record<string, readonly string[]>, example: string[]): Table | null {
  if (!ws) return null;
  const aoa = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
  const aliasToKey = new Map<string, string>();
  for (const [k, al] of Object.entries(spec)) for (const a of al) aliasToKey.set(a, k);
  let best = -1, bestHits = 0;
  for (let r = 0; r < Math.min(aoa.length, 50); r++) {
    const hits = new Set((aoa[r] ?? []).map((c) => aliasToKey.get(norm(c))).filter(Boolean)).size;
    if (hits > bestHits) { best = r; bestHits = hits; }
  }
  if (best < 0 || bestHits < 3) return null;
  const colOf = new Map<string, number>();
  (aoa[best] ?? []).forEach((c, j) => {
    const k = aliasToKey.get(norm(c));
    if (k && !colOf.has(k)) colOf.set(k, j);
  });
  const out: Table["rows"] = [];
  let exampleSkipped = false;
  for (let r = best + 1; r < aoa.length; r++) {
    const raw = aoa[r] ?? [];
    if (!raw.some((c) => c !== null && String(c).trim() !== "")) continue;
    const get = (k: string): Cell => {
      const j = colOf.get(k);
      if (j === undefined) return null;
      const v = raw[j];
      return typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v ?? null;
    };
    if (r === best + 1) {
      // The grey example row is skipped by CONTENT (it must match the template's example exactly).
      const leading = Object.keys(spec).slice(0, example.length).map((k) => String(get(k) ?? "").toLowerCase().trim());
      if (example.every((e, i) => leading[i] === e)) { exampleSkipped = true; continue; }
    }
    out.push({ row: r + 1, get });
  }
  return { rows: out, found: [...colOf.keys()], exampleSkipped };
}

function pickSheet(wb: XLSX.WorkBook, name: string, spec: Record<string, readonly string[]>, example: string[]): Table | null {
  const exact = wb.SheetNames.find((n) => norm(n) === name);
  const t = exact ? findTable(wb.Sheets[exact], spec, example) : null;
  if (t) return t;
  for (const n of wb.SheetNames) {
    if (n === exact) continue;
    const cand = findTable(wb.Sheets[n], spec, example);
    // the Items sheet is the one with SKU; Bookings is the one with Seller name / Pallets
    if (cand && (name === "items" ? cand.found.includes("sku") : cand.found.includes("pallets") || cand.found.includes("sellerName"))) return cand;
  }
  return null;
}

function toNumber(v: Cell, label: string, q: Quarantine[]): number | null {
  if (v === null) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) { q.push({ field: label, raw: String(v), reason: "is not a number" }); return null; }
    if (v < 0) { q.push({ field: label, raw: String(v), reason: "is negative" }); return null; }
    return v;
  }
  const s = String(v).replace(/[£,\s]/g, "").replace(/(kg|gbp|units?)$/i, "");
  const n = s === "" ? NaN : Number(s);
  if (!Number.isFinite(n)) { q.push({ field: label, raw: String(v), reason: "is not a number" }); return null; }
  if (n < 0) { q.push({ field: label, raw: String(v), reason: "is negative" }); return null; }
  return n;
}

function toText(v: Cell): string | null {
  if (v === null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

/** HS code as text: numbers keep their digits; a trailing ".0" is stripped by the rule. */
function toHs(v: Cell): string | null {
  if (v === null) return null;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return toText(v);
}

function toDate(v: Cell, q: Quarantine[]): string | null {
  if (v === null) return null;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const iso = parseDDMMYYYY(s) ?? (isIsoDate(s) ? s : null);
  if (!iso) q.push({ field: "Ready to ship date", raw: s, reason: "is not a DD-MM-YYYY date" });
  return iso;
}

function toYesNo(v: Cell): boolean | null {
  if (v === null) return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["yes", "y", "true", "booked", "1"].includes(s)) return true;
  if (["no", "n", "false", "not booked", "0"].includes(s)) return false;
  return null;
}

function toDestType(v: Cell): DestinationType | null {
  const s = norm(v);
  if (!s) return null;
  if (s.startsWith("warehouse") || ["dc", "distribution centre", "fulfilment centre", "fulfillment center"].includes(s)) return "Warehouse";
  if (s.startsWith("business")) return "Business address";
  return null;
}

function toPriority(v: Cell): Priority | null {
  const s = norm(v);
  return PRIORITIES.find((p) => norm(p) === s) ?? null;
}

export function parseWorkbook(data: ArrayBuffer | Uint8Array): ParsedWorkbook {
  const notes: string[] = [];
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data, { type: data instanceof ArrayBuffer ? "array" : "buffer", cellDates: false, raw: false });
  } catch {
    return { bookings: [], orphans: [], bookingRowsRead: 0, itemRowsRead: 0, exampleRowsSkipped: 0, notes: ["This file could not be opened as an Excel workbook (.xlsx). Please upload the template file."] };
  }
  const B = pickSheet(wb, "bookings", BOOKING_COLS, EXAMPLE_BOOKING);
  const I = pickSheet(wb, "items", ITEM_COLS, EXAMPLE_ITEM);
  if (!B) notes.push("No Bookings sheet with recognisable headers (e.g. Booking ID, Seller name, Pallets) was found.");
  if (!I) notes.push("No Items sheet with recognisable headers (e.g. Booking ID, SKU, Quantity) was found.");

  const bookings: Booking[] = (B?.rows ?? []).map(({ row, get }) => {
    const q: Quarantine[] = [];
    const destinationCity = canonicalCity(toText(get("destinationCity")), Object.keys(DESTINATION_CITIES)) ?? toText(get("destinationCity"));
    const rawType = toText(get("destinationType"));
    const destinationType = toDestType(get("destinationType"));
    if (rawType && !destinationType) notes.push(`Row ${row}: destination type "${rawType}" isn't Warehouse or Business address.`);
    const rawPriority = toText(get("priority"));
    const priority = toPriority(get("priority"));
    if (rawPriority && !priority) notes.push(`Row ${row}: seller priority "${rawPriority}" isn't one of ${PRIORITIES.join(" / ")}.`);
    const chosen = toText(get("chosenCarrier"));
    const b: Booking = {
      bookingId: toText(get("bookingId")) ?? `(no ID, row ${row})`,
      row,
      sellerName: toText(get("sellerName")),
      originCity: canonicalCity(toText(get("originCity")), ORIGIN_CITIES) ?? toText(get("originCity")),
      originCountry: normaliseCountry(toText(get("originCountry"))),
      destinationCity,
      destinationCountry: normaliseCountry(toText(get("destinationCountry"))) ?? cityCountry(destinationCity),
      destinationType,
      readyDate: toDate(get("readyDate"), q),
      priority,
      pallets: toNumber(get("pallets"), NUMERIC_LABEL.pallets, q),
      cartons: toNumber(get("cartons"), NUMERIC_LABEL.cartons, q),
      declaredValue: toNumber(get("declaredValue"), NUMERIC_LABEL.declaredValue, q),
      currency: toText(get("currency")),
      grossWeight: toNumber(get("grossWeight"), NUMERIC_LABEL.grossWeight, q),
      appointmentBooked: toYesNo(get("appointmentBooked")),
      chosenCarrier: chosen ? carrierId(chosen) : null,
      items: [],
      quarantined: q,
    };
    return b;
  });

  const key = (s: string) => s.trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const b of bookings) counts.set(key(b.bookingId), (counts.get(key(b.bookingId)) ?? 0) + 1);
  for (const b of bookings) if ((counts.get(key(b.bookingId)) ?? 0) > 1) b.duplicateOf = true;

  const orphans: OrphanRow[] = [];
  for (const { row, get } of I?.rows ?? []) {
    const q: Quarantine[] = [];
    const item: Item = {
      rowId: `i${row}`,
      row,
      sku: toText(get("sku")) ?? "",
      description: toText(get("description")) ?? "",
      hsCode: toHs(get("hsCode")),
      quantity: toNumber(get("quantity"), NUMERIC_LABEL.quantity, q),
      unitPrice: toNumber(get("unitPrice"), NUMERIC_LABEL.unitPrice, q),
      unitsPerCarton: toNumber(get("unitsPerCarton"), NUMERIC_LABEL.unitsPerCarton, q),
      cartons: toNumber(get("cartons"), NUMERIC_LABEL.cartons, q),
      unitWeight: toNumber(get("unitWeight"), NUMERIC_LABEL.unitWeight, q),
      countryOfOrigin: normaliseCountry(toText(get("countryOfOrigin"))),
      quarantined: q,
    };
    const id = toText(get("bookingId")) ?? "";
    const parents = bookings.filter((b) => key(b.bookingId) === key(id));
    if (!parents.length) orphans.push({ row, bookingId: id || "(blank)", sku: item.sku, description: item.description });
    for (const p of parents) p.items.push({ ...item, quarantined: [...q] });
  }

  return {
    bookings,
    orphans,
    bookingRowsRead: B?.rows.length ?? 0,
    itemRowsRead: I?.rows.length ?? 0,
    exampleRowsSkipped: (B?.exampleSkipped ? 1 : 0) + (I?.exampleSkipped ? 1 : 0),
    notes,
  };
}

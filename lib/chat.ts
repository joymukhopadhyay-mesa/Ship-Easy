// Deterministic conversation engine. An extractor (local regex or the model) supplies a
// PATCH; this code sanitises it (allow-list + source check), merges it, infers/computes
// what it may, never authors an R-03 error, and asks at most 3 grouped questions per turn.
import { canonicalCity, DESTINATION_CITIES, normaliseCountry, ORIGIN_CITIES, PRIORITIES } from "./config";
import { isIsoDate, prettyDate } from "./dates";
import { carrierReason, VERDICT_TEXT } from "./explain";
import { fmtNum, gbp, kg } from "./format";
import type { Slot } from "./localExtract";
import { sanitisePatch, type Patch, type Rejection } from "./patch";
import { applyEdits, newSession, type Edit, type Session } from "./session";
import type { Booking, CarrierId, DestinationType, Env, Item, Priority } from "./types";

export interface NonDivisible {
  rowId: string;
  sku: string;
  quantity: number;
  unitsPerCarton: number;
  remainder: number;
  options: { key: string; label: string; lines: { quantity: number; cartons: number; unitsPerCarton: number }[] }[];
}

export interface ChatState {
  session: Session;
  baselined: boolean;
  pending: NonDivisible | null;
  declined: string[];
  expecting: Slot[];
  nextRow: number;
  turns: number;
}

export interface TurnResult {
  state: ChatState;
  reply: string;
  rejected: Rejection[];
  applied: Patch;
}

export function emptyChatBooking(): Booking {
  return {
    bookingId: "CHAT-001", sellerName: null, originCity: null, originCountry: "United Kingdom", destinationCity: null,
    destinationCountry: null, destinationType: null, readyDate: null, priority: null, pallets: null, cartons: null,
    declaredValue: null, currency: "GBP", grossWeight: null, appointmentBooked: null, chosenCarrier: null, items: [],
  };
}

export function newChat(env: Env): ChatState {
  return { session: newSession("chat", emptyChatBooking(), env), baselined: false, pending: null, declined: [], expecting: [], nextRow: 1, turns: 0 };
}

const skuFor = (desc: string, n: number) => {
  const words = desc.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  const w = (words[words.length - 1] ?? "ITEM").replace(/S$/, "").slice(0, 6) || "ITEM";
  return `${w}-${String(n).padStart(2, "0")}`;
};

/** Options for a quantity that doesn't divide into full cartons. Every option satisfies R-03. */
export function nonDivisibleOptions(it: Item): NonDivisible | null {
  const q = it.quantity, u = it.unitsPerCarton;
  if (q == null || !u || q % u === 0) return null;
  const lo = Math.floor(q / u), hi = Math.ceil(q / u), r = q - lo * u;
  const options: NonDivisible["options"] = [];
  if (lo > 0) options.push({ key: "a", label: `${fmtNum(lo * u)} units in ${fmtNum(lo)} cartons`, lines: [{ quantity: lo * u, cartons: lo, unitsPerCarton: u }] });
  options.push({ key: "b", label: `${fmtNum(hi * u)} units in ${fmtNum(hi)} cartons`, lines: [{ quantity: hi * u, cartons: hi, unitsPerCarton: u }] });
  if (lo > 0) options.push({ key: "c", label: `keep ${fmtNum(q)} as ${fmtNum(lo)} cartons of ${u} plus 1 carton of ${r}, booked as a second line for the same SKU`, lines: [{ quantity: lo * u, cartons: lo, unitsPerCarton: u }, { quantity: r, cartons: 1, unitsPerCarton: r }] });
  return { rowId: it.rowId, sku: it.sku, quantity: q, unitsPerCarton: u, remainder: r, options };
}

function nonDivisiblePrompt(nd: NonDivisible): string {
  const opts = nd.options.map((o) => `(${o.key}) ${o.label}`).join(", ");
  return `${fmtNum(nd.quantity)} doesn't divide into ${nd.unitsPerCarton}s; the last carton would hold ${nd.remainder} units, and the rulebook needs an exact match. Which is right? ${opts}.`;
}

const ITEM_Q: Record<string, (d: string) => string> = {
  quantity: (d) => `How many units of ${d}?`,
  unitPrice: () => "What's the price per unit (GBP)?",
  unitsPerCarton: () => "How many units go in one carton?",
  unitWeight: () => "Roughly what does one unit weigh (kg)?",
  hsCode: () => "Do you have the HS code (at least 6 digits)? gov.uk/trade-tariff can find it, or say \"don't know\".",
  countryOfOrigin: () => "Where were they made? (UK, China, India, Vietnam, Turkey or Germany)",
};

/** Missing slots in group order; the first incomplete group is asked, max 3 questions. */
export function nextQuestions(st: ChatState): { slots: Slot[]; text: string[] } {
  const b = st.session.booking;
  const g1: [Slot, string][] = [];
  if (!b.destinationCity) g1.push([{ field: "destinationCity" }, "Where is it going? (Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam or Rotterdam)"]);
  if (!b.originCity) g1.push([{ field: "originCity" }, "Where do we collect from? (London, Manchester, Birmingham or Leeds)"]);
  if (!b.readyDate) g1.push([{ field: "readyDate" }, "When will it be packed and ready to collect?"]);
  if (!b.destinationType) g1.push([{ field: "destinationType" }, "Is it going to a warehouse / fulfilment centre, or to a business address such as a shop or office?"]);
  const g2: [Slot, string][] = [];
  if (!b.items.length) g2.push([{ field: "items" }, "What are you shipping? For example: \"1,080 ceramic mugs at £5 each, 12 per carton, 0.5 kg each\"."]);
  for (const it of b.items) {
    const fields = (["quantity", "unitPrice", "unitsPerCarton", "unitWeight", "hsCode", "countryOfOrigin"] as const).filter((f) => {
      if (st.declined.includes(`${f}@${it.rowId}`)) return false;
      return it[f] == null || it[f] === "";
    });
    if (fields.length) {
      fields.forEach((f, k) => g2.push([{ field: f, rowId: it.rowId, sku: it.sku }, `${k === 0 ? `For the ${it.description || it.sku}: ` : ""}${ITEM_Q[f](it.description || it.sku)}`]));
      break; // one item at a time
    }
  }
  const g3: [Slot, string][] = [];
  if (b.grossWeight == null) {
    const goods = b.items.every((i) => i.quantity != null && i.unitWeight != null) && b.items.length ? b.items.reduce((s, i) => s + i.quantity! * i.unitWeight!, 0) : null;
    g3.push([{ field: "grossWeight" }, `What's the total gross weight, including cartons and pallets?${goods ? ` The goods alone come to about ${kg(goods)}, so it will be more than that.` : ""}`]);
  }
  if (b.pallets == null) g3.push([{ field: "pallets" }, "How many pallets?"]);
  const g4: [Slot, string][] = [];
  if (!b.priority) g4.push([{ field: "priority" }, "What matters most: cheapest, fastest, most reliable, or a balance of all three?"]);
  if (b.destinationType === "Warehouse" && b.appointmentBooked == null) g4.push([{ field: "appointmentBooked" }, "Have you booked a delivery appointment with the warehouse?"]);
  const group = [g1, g2, g3, g4].find((g) => g.length) ?? [];
  const pick = group.slice(0, 3);
  return { slots: pick.map((p) => p[0]), text: pick.map((p) => p[1]) };
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.replace(/[,£\s]/g, "")))) return Number(v.replace(/[,£\s]/g, ""));
  return null;
};

/** Converts a sanitised patch into session edits (+ item adds/removes). */
function patchToEdits(st: ChatState, p: Patch): { edits: Edit[]; booking: Booking; nextRow: number; notes: string[]; declined: string[] } {
  const notes: string[] = [];
  const booking: Booking = { ...st.session.booking, items: st.session.booking.items.map((i) => ({ ...i })) };
  const edits: Edit[] = [];
  let nextRow = st.nextRow;
  const declined = [...st.declined];
  for (const [field, { value, source }] of Object.entries(p.set)) {
    switch (field) {
      case "destinationCity": {
        const c = canonicalCity(String(value ?? ""), Object.keys(DESTINATION_CITIES));
        if (c) { edits.push({ path: "destinationCity", value: c }); notes.push(`${c} is in ${DESTINATION_CITIES[c]}.`); }
        else notes.push(`I can only book to Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam or Rotterdam, so I've left the destination open.`);
        break;
      }
      case "originCity": {
        const c = canonicalCity(String(value ?? ""), ORIGIN_CITIES);
        if (c) edits.push({ path: "originCity", value: c });
        break;
      }
      case "destinationType": {
        const t: DestinationType | null = /ware/i.test(String(value)) ? "Warehouse" : /business/i.test(String(value)) ? "Business address" : null;
        if (t) { edits.push({ path: "destinationType", value: t }); notes.push(t === "Warehouse" ? `"${source}" → a warehouse delivery.` : `"${source}" → a business address.`); }
        break;
      }
      case "readyDate":
        if (isIsoDate(value)) {
          edits.push({ path: "readyDate", value });
          notes.push(/\d{1,2}[-/.]\d{1,2}[-/.]\d{4}/.test(source) ? `Ready on ${prettyDate(value)}.` : `I've read "${source}" as ${prettyDate(value)}; tell me if you meant another day.`);
        }
        break;
      case "priority": {
        const pr = PRIORITIES.find((x) => x.toLowerCase() === String(value).toLowerCase()) as Priority | undefined;
        if (pr) edits.push({ path: "priority", value: pr });
        break;
      }
      case "pallets": {
        const cur = booking.pallets ?? 0;
        const rel = typeof value === "string" && /^[+-]\d+$/.test(value) ? cur + Number(value) : null;
        const v = rel ?? num(value);
        if (v != null && v >= 0) edits.push({ path: "pallets", value: v });
        break;
      }
      case "grossWeight": {
        const v = num(value);
        if (v != null && v >= 0) edits.push({ path: "grossWeight", value: v });
        break;
      }
      case "appointmentBooked":
        edits.push({ path: "appointmentBooked", value: typeof value === "boolean" ? value : /^(y|yes|true|booked)/i.test(String(value)) });
        break;
      case "chosenCarrier": {
        const c = value == null ? null : (String(value).trim().toUpperCase().replace(/^CARRIER\s+/, "") as CarrierId);
        if (c === null || ["A", "B", "C"].includes(c)) edits.push({ path: "chosenCarrier", value: c });
        break;
      }
      case "sellerName":
        if (value) edits.push({ path: "sellerName", value: String(value) });
        break;
    }
  }
  for (const it of p.items) {
    const findBySku = (sku?: string | null) => booking.items.find((i) => sku && i.sku.toLowerCase() === sku.toLowerCase());
    let target = findBySku(it.sku);
    if (it.op === "remove") {
      if (target) booking.items = booking.items.filter((i) => i !== target);
      continue;
    }
    if (it.op === "add" || !target) {
      const desc = String(it.fields.description?.value ?? "item");
      const rowId = `c${nextRow}`;
      const fresh: Item = { rowId, sku: it.sku || skuFor(desc, nextRow), description: desc, hsCode: null, quantity: null, unitPrice: null, unitsPerCarton: null, cartons: null, unitWeight: null, countryOfOrigin: null };
      nextRow++;
      booking.items.push(fresh);
      target = fresh;
    }
    for (const [f, { value }] of Object.entries(it.fields)) {
      if (f === "description") { if (value) edits.push({ path: "item.description", rowId: target.rowId, value: String(value) }); continue; }
      if (f === "hsCode") { edits.push({ path: "item.hsCode", rowId: target.rowId, value: value == null ? null : String(value) }); continue; }
      if (f === "countryOfOrigin") { edits.push({ path: "item.countryOfOrigin", rowId: target.rowId, value: normaliseCountry(String(value ?? "")) }); continue; }
      const v = num(value);
      if (v != null && v >= 0) edits.push({ path: `item.${f}` as Edit["path"], rowId: target.rowId, value: v });
    }
  }
  for (const d of p.declined) {
    const it = booking.items.find((i) => d.sku && i.sku === d.sku) ?? (booking.items.length === 1 ? booking.items[0] : undefined);
    if (it) declined.push(`${d.field}@${it.rowId}`);
  }
  return { edits, booking, nextRow, notes, declined };
}

export function isComplete(st: ChatState): boolean {
  return !st.pending && nextQuestions(st).slots.length === 0;
}

/** One conversational turn. `stamp` = Europe/London "DD-MM-YYYY HH:mm" (injected). */
export function chatTurn(st0: ChatState, rawPatch: Patch, message: string, env: Env, stamp: string): TurnResult {
  const { patch, rejected } = sanitisePatch(rawPatch, message);
  let st: ChatState = { ...st0, turns: st0.turns + 1 };
  const notes: string[] = [];
  const firstTurn = st0.turns === 0;

  // Answer to the non-divisible question
  if (st.pending && patch.choice) {
    const nd = st.pending;
    const opt = nd.options.find((o) => o.key === patch.choice!.value);
    if (opt) {
      const it = st.session.booking.items.find((i) => i.rowId === nd.rowId)!;
      const b = { ...st.session.booking, items: st.session.booking.items.map((i) => ({ ...i })) };
      const edits: Edit[] = [{ path: "item.quantity", rowId: it.rowId, value: opt.lines[0].quantity }];
      let nextRow = st.nextRow;
      if (opt.lines[1]) {
        const second: Item = { ...it, rowId: `c${nextRow}`, quantity: opt.lines[1].quantity, unitsPerCarton: opt.lines[1].unitsPerCarton, cartons: null, hazardConfirmedAt: it.hazardConfirmedAt ?? null };
        nextRow++;
        b.items.push(second);
      }
      const s1 = { ...st.session, booking: b };
      const { session } = applyEdits(s1, edits, "chat", env, stamp, st.baselined);
      st = { ...st, session, pending: null, nextRow };
      notes.push(`Going with (${opt.key}): ${opt.label}.`);
    }
  }

  const conv = patchToEdits(st, patch);
  notes.push(...conv.notes);
  const s1 = { ...st.session, booking: conv.booking };
  const before = st.session;
  const { session, changes } = applyEdits(s1, conv.edits, "chat", env, stamp, st.baselined);
  st = { ...st, session, nextRow: conv.nextRow, declined: conv.declined };
  const added = session.booking.items.length - before.booking.items.length;
  // if items were added/removed, the change log entry still needs a line for it
  if (st.baselined && added !== 0 && st.session.log.length === before.log.length) {
    const entry = { at: stamp, source: "chat" as const, lines: [`Items ${before.booking.items.length} -> ${session.booking.items.length}`], verdictFrom: before.result.verdict, verdictTo: session.result.verdict };
    st = { ...st, session: { ...st.session, log: [...st.session.log, entry] } };
  }

  // Never author an R-03 error: a non-divisible quantity is raised BEFORE computing cartons.
  if (!st.pending) {
    for (const it of st.session.booking.items) {
      if (st.session.sellerCartons.includes(it.rowId)) continue;
      const nd = nonDivisibleOptions(it);
      if (nd) { st = { ...st, pending: nd }; break; }
    }
  } else {
    const it = st.session.booking.items.find((i) => i.rowId === st.pending!.rowId);
    if (!it || !nonDivisibleOptions(it)) st = { ...st, pending: null };
  }

  const b = st.session.booking;
  const res = st.session.result;
  if (firstTurn) notes.unshift("Origin is the UK and everything is in GBP, so I won't ask about those.");
  // computed values are shown, not hidden
  const computedNow = changes.filter((c) => /calculated/.test(c.label));
  if (computedNow.length) {
    const parts: string[] = [];
    for (const it of b.items) if (it.cartons != null && !st.session.sellerCartons.includes(it.rowId) && computedNow.some((c) => c.label.startsWith(it.sku))) parts.push(`${fmtNum(it.quantity)} ÷ ${it.unitsPerCarton} = ${fmtNum(it.cartons)} cartons of ${it.description}`);
    if (b.cartons != null && computedNow.some((c) => c.label.startsWith("Cartons"))) parts.push(`${fmtNum(b.cartons)} cartons in total`);
    if (b.declaredValue != null && computedNow.some((c) => c.label.startsWith("Declared"))) parts.push(`declared value ${gbp(b.declaredValue)} (${b.items.map((i) => `${fmtNum(i.quantity)} × ${gbp(i.unitPrice)}`).join(" + ")})`);
    if (parts.length) notes.push(`I worked out ${parts.join("; ")}. Tell me if your paperwork says otherwise.`);
  }
  // hazards (R-06 is always Red; implied needs the seller's declaration on the card)
  const r06 = res.rules.find((r) => r.id === "R-06");
  const r06Before = before.result.rules.find((r) => r.id === "R-06");
  if (r06?.status === "fail" && (r06Before?.status !== "fail" || r06Before?.state !== r06.state)) notes.push(r06.state === "explicit" ? `Heads-up: ${r06.message}` : `Heads-up: ${r06.message} If it doesn't, confirm it on the card (one click, logged with date and time).`);
  if (rejected.length) notes.push(`(I ignored ${rejected.length} value${rejected.length > 1 ? "s" : ""} I couldn't find in your message.)`);

  let reply: string;
  if (st.pending) {
    const nd = st.pending;
    st = { ...st, expecting: [{ field: "choice", rowId: nd.rowId, sku: nd.sku }] };
    reply = [...notes, nonDivisiblePrompt(nd)].join(" ");
  } else {
    const q = nextQuestions(st);
    st = { ...st, expecting: q.slots };
    if (q.slots.length) {
      const asks = q.text.length === 1 ? q.text[0] : q.text.map((t, k) => `(${k + 1}) ${t}`).join(" ");
      reply = [...notes, asks].join(" ");
      if (st.baselined && st.session.log.length > before.log.length) reply = `Updated: ${st.session.log[st.session.log.length - 1].lines.join(" · ")}. ` + reply;
    } else if (!st.baselined) {
      st = { ...st, baselined: true };
      const cr = carrierReason(res.carrier);
      reply = [...notes, `That's everything I need. ${VERDICT_TEXT[res.verdict]}`, cr.reason, cr.runnerUp ?? "", "Your booking card is on the right. Change anything by telling me, e.g. \"add another pallet\"."].filter(Boolean).join(" ");
    } else if (st.session.log.length > before.log.length) {
      const e = st.session.log[st.session.log.length - 1];
      reply = [...notes.filter((n) => !/^Origin is the UK/.test(n)), `Updated: ${e.lines.join(" · ")}.`, e.verdictFrom !== e.verdictTo ? `Verdict ${e.verdictFrom} → ${e.verdictTo}.` : `Verdict still ${e.verdictTo}.`].join(" ");
    } else {
      reply = [...notes, "Nothing changed. Tell me what to update — for example a new pallet count, weight, date or priority."].join(" ");
    }
  }
  return { state: st, reply, rejected, applied: patch };
}

/** Card edits / Apply / seller actions in a chat booking, logged like any other change. */
export function chatEdit(st: ChatState, edits: Edit[], source: "apply" | "edit" | "action" | "declaration", env: Env, stamp: string): ChatState {
  const { session } = applyEdits(st.session, edits, source, env, stamp, true);
  let next: ChatState = { ...st, session };
  if (st.pending) {
    const it = session.booking.items.find((i) => i.rowId === st.pending!.rowId);
    if (!it || !nonDivisibleOptions(it)) next = { ...next, pending: null };
  }
  return next;
}

/** What the extractor is allowed to know: asked slots and item names, never the booking numbers. */
export function extractContext(st: ChatState, today: string) {
  return {
    today,
    expecting: st.expecting,
    items: st.session.booking.items.map((i) => ({ sku: i.sku, description: i.description })),
    pendingChoice: Boolean(st.pending),
  };
}

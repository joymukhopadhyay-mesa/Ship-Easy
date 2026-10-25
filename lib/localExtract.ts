// Local-only extractor: turns one seller message into the same PATCH the model would
// return, with every value's "source" an exact substring of the message. Deterministic.
import { DESTINATION_CITIES, ORIGIN_CITIES } from "./config";
import { addDays, dayOfWeek, isIsoDate } from "./dates";
import { emptyPatch, type Patch, type SourcedValueT } from "./patch";

export interface Slot {
  field: string;
  rowId?: string;
  sku?: string;
}

export interface ExtractContext {
  today: string;
  /** Slots asked in the previous bot turn (bare answers map to these). */
  expecting: Slot[];
  /** Existing items, so attributes can be routed to the right one. */
  items: { sku: string; description: string }[];
  pendingChoice: boolean;
}

const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const toNum = (s: string) => Number(s.replace(/,/g, ""));
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const sv = (value: SourcedValueT["value"], source: string): SourcedValueT => ({ value, source: source.trim() });

/** Resolves a date phrase against today (Europe/London). Returns ISO + the matched phrase. */
export function findDate(msg: string, today: string): { iso: string; source: string } | null {
  let m: RegExpExecArray | null;
  if ((m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/.exec(msg))) {
    const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (isIsoDate(iso)) return { iso, source: m[0] };
  }
  if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(msg)) && isIsoDate(m[0])) return { iso: m[0], source: m[0] };
  const monthRe = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
  const withYear = (d: number, mon: string, y?: string) => {
    const mi = MONTHS.indexOf(mon.slice(0, 3).toLowerCase()) + 1;
    let year = y ? Number(y) : Number(today.slice(0, 4));
    let iso = `${year}-${String(mi).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (!y && iso < today) { year += 1; iso = `${year}-${String(mi).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
    return isIsoDate(iso) ? iso : null;
  };
  if ((m = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${monthRe}\b(?:,?\s+(\d{4}))?`, "i").exec(msg))) {
    const iso = withYear(Number(m[1]), m[2], m[3]);
    if (iso) return { iso, source: m[0] };
  }
  if ((m = new RegExp(String.raw`\b${monthRe}\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?`, "i").exec(msg))) {
    const iso = withYear(Number(m[2]), m[1], m[3]);
    if (iso) return { iso, source: m[0] };
  }
  if ((m = /\bday after tomorrow\b/i.exec(msg))) return { iso: addDays(today, 2), source: m[0] };
  if ((m = /\btomorrow\b/i.exec(msg))) return { iso: addDays(today, 1), source: m[0] };
  if ((m = /\b(?:ready\s+)?today\b/i.exec(msg))) return { iso: today, source: m[0] };
  if ((m = /\bin\s+(\d+|a|one|two|three)\s+(day|week)s?\b/i.exec(msg))) {
    const n = { a: 1, one: 1, two: 2, three: 3 }[m[1].toLowerCase() as "a"] ?? Number(m[1]);
    return { iso: addDays(today, m[2].toLowerCase() === "week" ? n * 7 : n), source: m[0] };
  }
  if ((m = /\bnext week\b/i.exec(msg))) {
    let d = addDays(today, 1);
    while (dayOfWeek(d) !== 1) d = addDays(d, 1);
    return { iso: d, source: m[0] };
  }
  if ((m = /\b(?:(next|this|on|coming)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(msg))) {
    // "next X", "this X" and a bare "X" all mean the first X after today; the bot confirms it.
    const target = DAYS.indexOf(m[2].toLowerCase());
    let d = addDays(today, 1);
    while (dayOfWeek(d) !== target) d = addDays(d, 1);
    return { iso: d, source: m[0] };
  }
  return null;
}

const DEST_TYPE: [RegExp, string][] = [
  [/\b(?:warehouse|distribution cent(?:re|er)|DC|fulfil?ment cent(?:re|er)|fulfil?ment|3PL|depot|amazon)\b/i, "Warehouse"],
  [/\b(?:shop|store|office|boutique|showroom|business address|retailer|restaurant|caf[eé]|salon|studio)\b/i, "Business address"],
];
const PRIORITY: [RegExp, string][] = [
  [/\b(?:balanced?|no (?:strong )?preference|best value|don'?t mind|best trade-?off|mix of)\b/i, "Balanced"],
  [/\b(?:most reliable|reliab(?:le|ility)|on[- ]time|dependable|safest)\b/i, "Most reliable"],
  [/\b(?:fastest|quickest|asap|urgent(?:ly)?|express|as soon as possible|speed|quick(?:ly)?|fast)\b/i, "Fastest"],
  [/\b(?:cheapest|cheap|lowest (?:cost|price)|budget|least expensive|save money|economy)\b/i, "Cheapest"],
];
const ORIGINS: [RegExp, string][] = [
  [/\b(?:uk|u\.k\.|united kingdom|britain|england|british)\b/i, "United Kingdom"],
  [/\b(?:china|chinese)\b/i, "China"],
  [/\b(?:india|indian)\b/i, "India"],
  [/\b(?:vietnam|viet nam|vietnamese)\b/i, "Vietnam"],
  [/\b(?:turkey|t[uü]rkiye|turkish)\b/i, "Turkey"],
  [/\b(?:germany|german)\b/i, "Germany"],
];

const NOT_ITEM = /^(?:pallets?|cartons?|boxes|box|cases?|kg|kgs|kilos?|kilograms?|tonnes?|g|grams?|units?\s+(?:per|a|in|to)|per\b|a carton|to a|days?|weeks?|hours?|percent|%|gbp|pounds?|each|of them|in total|total|items?\b|skus?\b|products?\b|lines?\b|dollars?|euros?|am|pm|st|nd|rd|th|x\s*\d)/i;
const STOP = String.raw`(?=\s*(?:,|;|\.(?:\s|$)|$|\bat\b|\bto\b|\bfrom\b|\bfor\b|@|\beach\b|\bpriced\b|\bcosting\b|\bcost\b|\bin\b|\bpacked\b|\bwith\b|\bthat\b|\bwhich\b|\bmade\b|\bweigh|\(|£|\band\b|\bplus\b|\bready\b|\bgoing\b|\bheading\b|\bon\b|\bvia\b|\bby\b|\bcollect|\bhs\b|\bshipping\b|\bsent\b|\bneed\b|-))`;

interface ItemHit { start: number; end: number; qty: number; qtySrc: string; desc: string; descSrc: string }

function findItems(msg: string, masked: string): ItemHit[] {
  const re = new RegExp(String.raw`(?<![£\d.,:/-])(${NUM})\s*(?:x\s+|units?\s+of\s+|pieces?\s+of\s+|pcs\s+(?:of\s+)?|packs?\s+of\s+)?([a-zA-Z][a-zA-Z0-9'’\- ]*?)${STOP}`, "gi");
  const out: ItemHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const desc = m[2].trim();
    if (!desc || NOT_ITEM.test(desc) || desc.length < 3) continue;
    const before = masked.slice(Math.max(0, m.index - 10), m.index);
    if (/\b(?:hs|code|no\.?|number)\s*(?:is|:|#)?\s*$/i.test(before)) continue;
    const descStart = m.index + m[0].indexOf(m[2]);
    out.push({ start: m.index, end: m.index + m[0].length, qty: toNum(m[1]), qtySrc: msg.slice(m.index, descStart + desc.length), desc, descSrc: msg.slice(descStart, descStart + desc.length) });
  }
  return out;
}

/** Item-level attributes inside a text span. */
function itemAttrs(seg: string): Record<string, SourcedValueT> {
  const f: Record<string, SourcedValueT> = {};
  let m: RegExpExecArray | null;
  if ((m = new RegExp(String.raw`£\s?(${NUM})(?!\s*(?:in total|total|declared|altogether|overall|for the lot|for everything))`, "i").exec(seg))) f.unitPrice = sv(toNum(m[1]), m[0]);
  else if ((m = new RegExp(String.raw`\b(${NUM})\s*(?:gbp|pounds?|quid)\s*(?:each|per unit|a unit|apiece|per item|a piece)`, "i").exec(seg))) f.unitPrice = sv(toNum(m[1]), m[0]);
  if ((m = new RegExp(String.raw`\b(\d+)\s*(?:units?\s*|pcs\s*|pieces\s*)?(?:per|a|to a|in a|in each|in every|/)\s*(?:carton|box|case|ctn)\b`, "i").exec(seg))) f.unitsPerCarton = sv(Number(m[1]), m[0]);
  else if ((m = /\b(?:cartons?|boxes|cases)\s+of\s+(\d+)\b/i.exec(seg))) f.unitsPerCarton = sv(Number(m[1]), m[0]);
  if ((m = new RegExp(String.raw`\b(${NUM})\s+(?:cartons|boxes|cases)\b(?!\s+of)`, "i").exec(seg))) f.cartons = sv(toNum(m[1]), m[0]);
  if ((m = new RegExp(String.raw`\b(${NUM})\s*(kg|kgs|kilos?|kilograms?|g|grams?)\s*(?:each|per unit|apiece|a piece|per item|per piece|a unit|per [a-z]+)\b`, "i").exec(seg))) {
    const v = toNum(m[1]) / (/^g/i.test(m[2]) ? 1000 : 1);
    f.unitWeight = sv(v, m[0]);
  } else if ((m = new RegExp(String.raw`\b(?:each|one|a unit|per unit)\s+(?:weighs|is)\s+(${NUM})\s*(kg|kgs|kilos?|g|grams?)\b`, "i").exec(seg))) {
    f.unitWeight = sv(toNum(m[1]) / (/^g/i.test(m[2]) ? 1000 : 1), m[0]);
  }
  if ((m = /\b(?:hs|commodity|tariff)(?:\s*code)?\s*(?:is|:|#|no\.?|number)?\s*(\d[\d.\s]{3,13}\d)\b/i.exec(seg))) f.hsCode = sv(m[1].replace(/\s+/g, ""), m[0]);
  if ((m = /\b(?:made|manufactured|produced) in (?:the )?([a-z.\s]+?)(?=[,.;]|$|\s(?:and|at|to|from|with|for)\b)/i.exec(seg))) {
    const o = ORIGINS.find(([re]) => re.test(m![1]));
    if (o) f.countryOfOrigin = sv(o[1], m[0]);
  } else if ((m = /\b(?:country of origin|origin)\s*(?:is|:)?\s*([a-z.\s]+?)(?=[,.;]|$)/i.exec(seg))) {
    const o = ORIGINS.find(([re]) => re.test(m![1]));
    if (o) f.countryOfOrigin = sv(o[1], m[0]);
  } else if ((m = /\b(chinese|indian|vietnamese|turkish|german|british)[- ]made\b/i.exec(seg))) {
    f.countryOfOrigin = sv(ORIGINS.find(([re]) => re.test(m![1]))![1], m[0]);
  } else if ((m = /\bfrom (china|india|vietnam|turkey)\b/i.exec(seg))) {
    f.countryOfOrigin = sv(ORIGINS.find(([re]) => re.test(m![1]))![1], m[0]);
  }
  return f;
}

export function extractLocal(message: string, ctx: ExtractContext): Patch {
  const p = emptyPatch();
  const msg = message;
  let m: RegExpExecArray | null;

  // Pending multiple choice ("(b)", "option b", "b please")
  if (ctx.pendingChoice && (m = /^\s*(?:option\s*)?\(?([abc])\)?(?:\s*(?:please|thanks|pls))?\s*[.!]?\s*$/i.exec(msg))) {
    p.choice = { value: m[1].toLowerCase(), source: m[0].trim() };
    return p;
  }

  // Dates first, then mask them so their digits aren't read as quantities.
  const date = findDate(msg, ctx.today);
  if (date) p.set.readyDate = sv(date.iso, date.source);
  let masked = date ? msg.replace(date.source, " ".repeat(date.source.length)) : msg;

  for (const city of Object.keys(DESTINATION_CITIES)) {
    if ((m = new RegExp(String.raw`\b${city}\b`, "i").exec(msg))) { p.set.destinationCity = sv(city, m[0]); break; }
  }
  for (const city of ORIGIN_CITIES) {
    if ((m = new RegExp(String.raw`\b${city}\b`, "i").exec(msg))) { p.set.originCity = sv(city, m[0]); break; }
  }
  for (const [re, v] of DEST_TYPE) if ((m = re.exec(msg))) { p.set.destinationType = sv(v, m[0]); break; }
  for (const [re, v] of PRIORITY) if ((m = re.exec(msg))) { p.set.priority = sv(v, m[0]); break; }

  // Pallets: relative first ("add another pallet"), then absolute ("3 pallets").
  if ((m = /\b(?:add|plus)\s+(\d+)\s+(?:more\s+|extra\s+)?pallets?\b/i.exec(msg))) p.set.pallets = sv(`+${m[1]}`, m[0]);
  else if ((m = /\b(?:add(?:ing)?\s+(?:a|an|one|another)(?:\s+more|\s+extra)?|another|one more|an extra|extra)\s+pallet\b/i.exec(msg))) p.set.pallets = sv("+1", m[0]);
  else if ((m = /\b(?:remove|drop|take off|lose)\s+(?:a|one)\s+pallet\b|\bone (?:less|fewer) pallet\b/i.exec(msg))) p.set.pallets = sv("-1", m[0]);
  else if ((m = new RegExp(String.raw`\b(\d+)\s*pallets?\b`, "i").exec(masked))) p.set.pallets = sv(Number(m[1]), msg.slice(m.index, m.index + m[0].length));
  if (p.set.pallets) masked = masked.replace(/\b\d+\s*pallets?\b/i, (s) => " ".repeat(s.length));

  // Gross weight: a kg figure that is NOT "each/per unit".
  const grossRe = new RegExp(String.raw`\b(${NUM})\s*(kg|kgs|kilos?|kilograms?|tonnes?|t)\b(?!\s*(?:each|per|apiece|a piece|a unit))`, "gi");
  while ((m = grossRe.exec(masked))) {
    const raw = msg.slice(m.index, m.index + m[0].length);
    const v = toNum(m[1]) * (/^t/i.test(m[2]) ? 1000 : 1);
    const after = masked.slice(m.index + m[0].length, m.index + m[0].length + 14);
    if (/^\s*(?:each|per|apiece)/i.test(after)) continue;
    p.set.grossWeight = sv(v, raw);
    masked = masked.slice(0, m.index) + " ".repeat(m[0].length) + masked.slice(m.index + m[0].length);
    break;
  }

  // Appointment
  if ((m = /\b(?:no|not|haven'?t|have not|without|don'?t have)\s+(?:an?\s+|any\s+|got\s+an?\s+)?(?:delivery\s+)?(?:appointment|slot)\b|\b(?:appointment|slot)\s+(?:is\s+|isn'?t\s+|has\s+)?not\s+(?:yet\s+)?booked\b|\bnot booked\b/i.exec(msg))) p.set.appointmentBooked = sv(false, m[0]);
  else if ((m = /\b(?:appointment|slot)s?\b[^.]{0,20}?\b(?:is |are |'s |has been )?(?:booked|confirmed|arranged|sorted|done|in place)\b|\b(?:booked|have|got|arranged)\s+(?:an?|the)\s+(?:delivery\s+)?(?:appointment|slot)\b/i.exec(msg))) p.set.appointmentBooked = sv(true, m[0]);

  // Carrier override
  if ((m = /\b(?:use|go with|switch to|book with|choose|pick|prefer|want)\s+(?:carrier\s+)?([abc])\b(?!\w)/i.exec(msg)) && /carrier|^\s*(?:use|go with|switch to)/i.test(msg)) p.set.chosenCarrier = sv(m[1].toUpperCase(), m[0]);
  else if ((m = /\b(?:use|go back to|switch back to)\s+the\s+recommended(?:\s+carrier)?\b/i.exec(msg))) p.set.chosenCarrier = sv(null, m[0]);

  if ((m = /\b(?:seller|company|business)(?:\s+name)?\s*(?:is|:)\s*([A-Z][\w&'.-]*(?:\s+[A-Z&][\w&'.-]*){0,4})/.exec(msg))) p.set.sellerName = sv(m[1], m[1]);

  // Items: "1,000 ceramic mugs ..." splits the message into item segments.
  const hits = findItems(msg, masked);
  const known = (d: string) => ctx.items.find((i) => i.description.toLowerCase() === d.toLowerCase());
  if (hits.length) {
    hits.forEach((h, k) => {
      const segEnd = k + 1 < hits.length ? hits[k + 1].start : msg.length;
      const seg = msg.slice(hits.length === 1 ? 0 : h.start, hits.length === 1 ? msg.length : segEnd);
      const attrs = itemAttrs(seg);
      if (p.set.grossWeight && attrs.unitWeight?.source === p.set.grossWeight.source) delete attrs.unitWeight;
      const existing = known(h.desc);
      const fields = { description: sv(h.desc, h.descSrc), quantity: sv(h.qty, h.qtySrc), ...attrs };
      if (existing) p.items.push({ op: "update", sku: existing.sku, fields });
      else p.items.push({ op: "add", sku: null, fields });
    });
  } else {
    // Attributes for existing items ("£5 each, 12 per carton").
    const attrs = itemAttrs(msg);
    // Bare answers to a single asked slot
    const exp = ctx.expecting;
    const bareNum = new RegExp(String.raw`^\s*(?:about|around|roughly|approx\.?)?\s*£?\s*(${NUM})\s*(kg|kgs|kilos?|g|grams?)?\s*(?:each|units?|pallets?|cartons?)?\s*[.!]?\s*$`, "i").exec(msg);
    const itemSlots = exp.filter((s) => s.rowId || s.sku);
    if (bareNum && exp.length === 1) {
      const s = exp[0];
      const v = toNum(bareNum[1]) / (bareNum[2] && /^g/i.test(bareNum[2]) ? 1000 : 1);
      if (["pallets", "grossWeight"].includes(s.field) && !p.set[s.field]) p.set[s.field] = sv(v, bareNum[0]);
      else if (["quantity", "unitPrice", "unitsPerCarton", "unitWeight", "cartons", "hsCode"].includes(s.field)) attrs[s.field] = sv(s.field === "hsCode" ? bareNum[1].replace(/,/g, "") : v, bareNum[0]);
    }
    if ((m = /^\s*(\d{6,10})\s*$/.exec(msg)) && exp.some((s) => s.field === "hsCode")) attrs.hsCode = sv(m[1], m[0]);
    if (Object.keys(attrs).length) {
      const targetSku = itemSlots[0]?.sku ?? (ctx.items.length === 1 ? ctx.items[0].sku : null);
      if (targetSku) p.items.push({ op: "update", sku: targetSku, fields: attrs });
    }
    // Bare origin answer ("China") when asked
    if (exp.some((s) => s.field === "countryOfOrigin")) {
      const o = ORIGINS.find(([re]) => re.test(msg));
      const slot = exp.find((s) => s.field === "countryOfOrigin")!;
      if (o && slot.sku && !p.items.some((i) => i.fields.countryOfOrigin)) {
        const mm = o[0].exec(msg)!;
        const upd = p.items.find((i) => i.sku === slot.sku);
        if (upd) upd.fields.countryOfOrigin = sv(o[1], mm[0]);
        else p.items.push({ op: "update", sku: slot.sku, fields: { countryOfOrigin: sv(o[1], mm[0]) } });
        if (p.set.originCity && /^(?:uk|united kingdom)$/i.test(mm[0])) delete p.set.originCity;
      }
    }
  }

  // Bare yes/no to the appointment question
  if (!p.set.appointmentBooked && ctx.expecting.some((s) => s.field === "appointmentBooked")) {
    if ((m = /^\s*(yes|yep|yeah|yup|it is|booked|done|correct|y)\b/i.exec(msg))) p.set.appointmentBooked = sv(true, m[0]);
    else if ((m = /^\s*(no|nope|not yet|nah|n)\b/i.exec(msg))) p.set.appointmentBooked = sv(false, m[0]);
  }

  // "don't know" for fields that may legitimately stay blank (HS code, country of origin)
  if ((m = /\b(?:don'?t|do not|dont)\s+know\b|\bnot sure\b|\bno idea\b|\bunknown\b|\bskip\b|\bdon'?t have (?:it|one|that)\b/i.exec(msg))) {
    for (const s of ctx.expecting) if (s.field === "hsCode" || s.field === "countryOfOrigin") p.declined.push({ field: s.field, sku: s.sku ?? null, source: m[0] });
  }
  return p;
}

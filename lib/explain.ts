// Templated plain-English text (Local-only voice). No model, no business logic:
// every number shown here was computed by the engine.
import { prettyDate } from "./dates";
import { fmtNum, gbp, gbpText, kg, plural } from "./format";
import type { BookingResult, CarrierId, CarrierOption, CarrierResult, RuleResult, Verdict } from "./types";

export const VERDICT_TEXT: Record<Verdict, string> = {
  BLOCKED: "Blocked: at least one Red check fails. This must not ship until it's fixed.",
  "SHIP WITH CARE": "Ship with care: no Reds, but some Amber checks need attention.",
  "CLEAR TO SHIP": "Clear to ship: every check passes.",
  INCOMPLETE: "Incomplete: some data is missing, so not every check could run.",
};

const WHY: Record<string, string> = {
  "R-01": "Customs classifies goods by HS code; a short or missing code is a common cause of customs holds.",
  "R-02": "Customs checks the invoice total against the items; a mismatch can hold the shipment or trigger a duty reassessment.",
  "R-03": "If cartons × units per carton doesn't equal the quantity, the receiving warehouse will report units missing or extra.",
  "R-04": "The carrier and warehouse count cartons against the booking; a mismatch means a discrepancy on arrival.",
  "R-05": "Carriers refuse pallets heavier than their service limit.",
  "R-06": "Lithium batteries, aerosols and flammable liquids need dangerous-goods handling that these road services don't offer.",
  "R-07": "The gross weight includes cartons and pallets, so it can't be less than the goods alone; an under-declared weight gets re-weighed and re-charged.",
  "R-08": "Warehouses usually turn away deliveries without a booked slot.",
  "R-09": "Customs needs where each product was made to work out duty and origin rules.",
  "R-10": "A collection date in the past can't be booked.",
};

export function whyItMatters(id: string): string {
  return WHY[id] ?? "";
}

export const STATUS_LABEL: Record<RuleResult["status"], string> = {
  pass: "Pass",
  fail: "Fail",
  not_checked: "Not checked",
  cannot_compute: "Cannot compute",
};

export function fixText(r: RuleResult, res: BookingResult): string {
  const c = res.carrier;
  switch (r.id) {
    case "R-05": {
      if (r.state === "no_carrier_fits") {
        const mins = Object.entries(c.minPallets).map(([id, n]) => `Carrier ${id}: ${n}`).join(", ");
        return `Spread the load over more pallets. Minimum pallets per carrier: ${mins}. Or check the gross weight, which may be overstated (confidence: Possible).`;
      }
      if (r.state === "seller_override") {
        const need = c.chosen ? c.minPallets[c.chosen] : null;
        const rec = c.recommended ? `switch to Carrier ${c.recommended}` : "pick another carrier";
        return `Either ${rec}, or keep Carrier ${c.chosen} and use ${need} pallets (add ${need! - (res.booking.pallets ?? 0)}).`;
      }
      return "Enter the number of pallets (and gross weight) so weight per pallet can be checked.";
    }
    case "R-06":
      return r.state === "explicit"
        ? "Remove this item from the booking. These services can't carry restricted dangerous goods."
        : "If the item has no lithium battery, aerosol or flammable liquid, confirm with one click (logged with date and time). Otherwise remove it.";
    case "R-08":
      return "Book a delivery slot with the receiving warehouse before the collection date, then tick it here.";
    case "R-09":
      return "Add where each flagged product was made: United Kingdom, China, India, Vietnam, Turkey or Germany.";
    case "R-10":
      return "Choose a ready date of today or later.";
    default:
      return "See the suggested fix below.";
  }
}

const opt = (c: CarrierResult, id: CarrierId | null) => c.options.find((o) => o.id === id) ?? null;

export function carrierLabel(o: CarrierOption | null): string {
  return o ? `${o.name} (${o.service})` : "none";
}

export function tradeOff(a: CarrierOption, b: CarrierOption): string {
  const parts: string[] = [];
  const dc = (b.totalCost ?? 0) - (a.totalCost ?? 0);
  if (dc !== 0) parts.push(`${gbp(Math.abs(dc))} ${dc > 0 ? "more" : "less"}`);
  const dt = b.transitDays - a.transitDays;
  if (dt !== 0) parts.push(`${plural(Math.abs(dt), "day")} ${dt < 0 ? "faster" : "slower"}`);
  const dr = b.onTimePct - a.onTimePct;
  if (dr !== 0) parts.push(`${Math.abs(dr)} points ${dr > 0 ? "more" : "less"} reliable`);
  return parts.join(", ") || "identical on every measure";
}

/** Why the recommended carrier fits the seller's priority, plus runner-up and exclusions. */
export function carrierReason(c: CarrierResult): { reason: string; runnerUp: string | null; excluded: string[] } {
  const rec = opt(c, c.recommended);
  const per = c.kgPerPallet;
  const excluded = c.options.filter((o) => !o.feasible && per != null).map((o) => `${o.name} can't take it: ${kg(per!)} per pallet is over its ${fmtNum(o.maxKgPerPallet)} kg limit.`);
  if (!rec) return { reason: per == null ? "Carrier can't be chosen until pallets, gross weight and destination are known." : "No carrier on this lane can take this weight per pallet.", runnerUp: null, excluded };
  const pr = c.priorityAssumed ? "Balanced (assumed)" : c.priority;
  const among = c.feasible.length === 1 ? "the only carrier that can take this load" : `best for "${pr}" among ${c.feasible.length} carriers that can take ${kg(per!)} per pallet`;
  let why: string;
  switch (c.priority) {
    case "Cheapest": why = `lowest total cost, ${gbp(rec.totalCost)}`; break;
    case "Fastest": why = `shortest transit, ${plural(rec.transitDays, "day")}`; break;
    case "Most reliable": why = `highest on-time rate, ${rec.onTimePct}%`; break;
    default: {
      const s = c.balanced.find((b) => b.id === rec.id);
      why = `lowest Balanced score, ${s ? s.score.toFixed(2) : "—"} (0 = best; weights cost ${Math.round(c.weights.cost * 100)} / transit ${Math.round(c.weights.transit * 100)} / reliability ${Math.round(c.weights.reliability * 100)})`;
    }
  }
  const reason = `${rec.name} (${rec.service}) is ${among}: ${why}. ${gbp(rec.totalCost)} total, ${plural(rec.transitDays, "day")} transit, ${rec.onTimePct}% on time.`;
  const ru = opt(c, c.runnerUp);
  return { reason, runnerUp: ru ? `Runner-up ${ru.name}: ${tradeOff(rec, ru)}.` : null, excluded };
}

export function confirmation(res: BookingResult): string {
  const b = res.booking;
  const c = res.carrier;
  const items = b.items.map((i) => `${fmtNum(i.quantity)} × ${i.description || i.sku}`).join(", ") || "no items yet";
  const dest = `${b.destinationType === "Warehouse" ? "the warehouse" : b.destinationType === "Business address" ? "the business address" : "the destination"} in ${b.destinationCity ?? "?"}${c.lane ? `, ${c.lane}` : ""}`;
  const chosen = opt(c, c.chosen);
  const parts = [
    `You're sending ${items} (${plural(b.cartons ?? 0, "carton")} on ${plural(b.pallets ?? 0, "pallet")}, ${kg(b.grossWeight)} gross, declared ${gbp(b.declaredValue)}) from ${b.originCity ?? "the UK"} to ${dest}.`,
    b.readyDate ? `Goods are ready on ${prettyDate(b.readyDate)}.` : "",
    chosen && c.dates.collection
      ? `${chosen.name} (${chosen.service}) collects on ${prettyDate(c.dates.collection)} and should deliver by ${prettyDate(c.dates.eta)}, for ${gbp(chosen.totalCost)}.`
      : "No carrier can be booked yet.",
  ];
  const reds = res.rules.filter((r) => r.status === "fail" && r.severity === "Red").map((r) => r.id);
  const ambers = res.rules.filter((r) => r.status === "fail" && r.severity === "Amber").map((r) => r.id);
  if (reds.length) parts.push(`It can't ship until ${reds.join(", ")} ${reds.length === 1 ? "is" : "are"} fixed.`);
  else if (res.verdict === "INCOMPLETE") parts.push("Some details are still missing before every check can run.");
  else if (ambers.length) parts.push(`It can ship, but check ${ambers.join(", ")} first.`);
  else parts.push("Everything checks out.");
  return parts.filter(Boolean).join(" ");
}

export function nextSteps(res: BookingResult): { text: string; done: boolean }[] {
  const b = res.booking;
  const c = res.carrier;
  const steps: { text: string; done: boolean }[] = [];
  const blocking = res.rules.filter((r) => r.status === "fail" && r.severity === "Red");
  if (blocking.length) steps.push({ text: `Fix the Red findings (${blocking.map((r) => r.id).join(", ")}) — the booking can't be released until they pass.`, done: false });
  if (b.destinationType === "Warehouse") {
    steps.push(b.appointmentBooked
      ? { text: "Delivery appointment booked: keep the slot reference handy for the driver.", done: true }
      : { text: `Book a delivery appointment with the receiving warehouse before ${c.dates.collection ? prettyDate(c.dates.collection) : "collection"}.`, done: false });
  }
  steps.push({ text: "Prepare the commercial invoice (HS code, quantity, unit price, country of origin per line) and a packing list; have your EORI number ready.", done: false });
  steps.push({ text: `Label every carton with the booking ID${b.bookingId ? ` (${b.bookingId})` : ""}, the SKU and "carton n of ${b.cartons ?? "N"}".`, done: false });
  const chosen = opt(c, c.chosen);
  if (chosen && c.dates.collection) steps.push({ text: `${chosen.name} collects ${plural(b.pallets ?? 0, "pallet")} on ${prettyDate(c.dates.collection)}; expected delivery ${prettyDate(c.dates.eta)}.`, done: false });
  return steps;
}

/** One-paragraph narrative for a whole upload (Local-only voice). */
export function uploadNarrative(results: BookingResult[]): string {
  const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  return `${plural(results.length, "booking")} checked: ${count("BLOCKED")} blocked, ${count("SHIP WITH CARE")} ship with care, ${count("CLEAR TO SHIP")} clear to ship, ${count("INCOMPLETE")} incomplete. Open any booking to see what is wrong, how serious it is and how to fix it.`;
}

export { gbpText };

// Change log (spec A10): every edit re-runs validation; the diff lists what the
// seller changed, weight per pallet, which checks flipped, and the carrier delta.
import { fmtNum, gbpText, plural } from "./format";
import type { BookingResult, CarrierResult, RuleResult, Verdict } from "./types";

export interface FieldChange {
  label: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}

export interface ChangeLogEntry {
  at: string; // "DD-MM-YYYY HH:mm" Europe/London
  source: "chat" | "apply" | "edit" | "action" | "declaration";
  lines: string[];
  verdictFrom: Verdict;
  verdictTo: Verdict;
}

const STATE_LABEL: Record<string, string> = {
  no_carrier_fits: "no carrier fits",
  seller_override: "seller override",
  explicit: "explicit",
  implied: "pending confirmation",
};

export function ruleLabel(r: RuleResult): string {
  if (r.status === "pass") return "Pass";
  if (r.status === "not_checked") return "Not checked";
  if (r.status === "cannot_compute") return "Cannot compute";
  return r.state && STATE_LABEL[r.state] ? `${r.severity} (${STATE_LABEL[r.state]})` : r.severity;
}

function carrierText(c: CarrierResult): string {
  const o = c.options.find((x) => x.id === c.chosen);
  return o ? `${o.id} (${o.transitDays}d, ${gbpText(o.totalCost)})` : "none";
}

const show = (v: FieldChange["from"]) => (v === null || v === "" ? "blank" : typeof v === "boolean" ? (v ? "Yes" : "No") : typeof v === "number" ? fmtNum(v) : v);

export function diffLines(prev: BookingResult, next: BookingResult, changes: FieldChange[]): string[] {
  const lines = changes.map((c) => `${c.label} ${show(c.from)} -> ${show(c.to)}`);
  const a = prev.carrier.kgPerPallet;
  const b = next.carrier.kgPerPallet;
  if (a !== null && b !== null && Math.round(a) !== Math.round(b)) lines.push(`Weight/pallet ${fmtNum(Math.round(a))} -> ${fmtNum(Math.round(b))} kg`);
  else if ((a === null) !== (b === null)) lines.push(`Weight/pallet ${a === null ? "unknown" : fmtNum(Math.round(a)) + " kg"} -> ${b === null ? "unknown" : fmtNum(Math.round(b)) + " kg"}`);

  const flips = next.rules
    .map((r) => ({ r, before: prev.rules.find((p) => p.id === r.id)! }))
    .filter(({ r, before }) => ruleLabel(before) !== ruleLabel(r))
    .map(({ r, before }) => `${r.id} ${ruleLabel(before)} -> ${ruleLabel(r)}`);
  lines.push(...(flips.length ? flips : ["No checks changed"]));

  const ca = carrierText(prev.carrier);
  const cb = carrierText(next.carrier);
  if (ca !== cb) {
    let line = `Carrier ${ca} -> ${cb}`;
    const oa = prev.carrier.options.find((x) => x.id === prev.carrier.chosen);
    const ob = next.carrier.options.find((x) => x.id === next.carrier.chosen);
    if (oa && ob) {
      const extra: string[] = [];
      const dc = (ob.totalCost ?? 0) - (oa.totalCost ?? 0);
      if (dc !== 0) extra.push(`${dc > 0 ? "+" : "-"}${gbpText(Math.abs(dc))}`);
      const dt = ob.transitDays - oa.transitDays;
      if (dt !== 0) extra.push(`${plural(Math.abs(dt), "day")} ${dt < 0 ? "faster" : "slower"}`);
      if (extra.length) line += ` ${extra.join(", ")}`;
    }
    lines.push(line);
  }
  return lines;
}

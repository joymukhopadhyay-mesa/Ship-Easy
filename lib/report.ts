// Printable pre-flight report (standalone HTML). Every number comes from the engine.
import type { ChangeLogEntry } from "./changelog";
import { prettyDate } from "./dates";
import { carrierReason, confirmation, fixText, nextSteps, VERDICT_TEXT, whyItMatters } from "./explain";
import { gbp } from "./format";
import { invoiceDraft } from "./invoice";
import type { BookingResult } from "./types";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const COLOR: Record<string, string> = { BLOCKED: "#DC2626", "SHIP WITH CARE": "#D97706", "CLEAR TO SHIP": "#16A34A", INCOMPLETE: "#6B7280" };

function bookingSection(r: BookingResult, log: ChangeLogEntry[]): string {
  const c = r.carrier;
  const cr = carrierReason(c);
  const findings = r.rules.filter((x) => x.status !== "pass");
  const inv = invoiceDraft(r.booking);
  return `<section>
  <h2>${esc(r.booking.bookingId)} <span class="badge" style="background:${COLOR[r.verdict]}">${esc(r.verdict)}</span></h2>
  <p>${esc(VERDICT_TEXT[r.verdict])}</p>
  ${log.length ? `<h3>Change log</h3><ul>${log.map((e) => `<li><b>${esc(e.at)}</b> ${e.lines.map(esc).join(" | ")}</li>`).join("")}</ul>` : ""}
  ${r.gate.length ? `<h3>Data completeness</h3><ul>${r.gate.map((g) => `<li><b>${g.code}</b> ${esc(g.message)}</li>`).join("")}</ul>` : ""}
  <h3>Findings</h3>
  ${findings.length ? `<table><tr><th>Rule</th><th>Severity</th><th>Problem</th><th>Numbers</th><th>Fix</th></tr>${findings.map((f) => {
    const reps = r.repairs.filter((x) => x.rules.includes(f.id));
    const fix = reps.length ? reps.map((x) => `${esc(x.message)} <i>(confidence: ${x.confidence}${x.applyEnabled ? "" : ", not auto-applied"})</i>`).join("<br>") : esc(fixText(f, r));
    return `<tr><td>${f.id}</td><td>${f.status === "fail" ? f.severity : esc(f.status.replace("_", " "))}</td><td>${esc(f.message)}${f.caveat ? `<br><i>${esc(f.caveat)}</i>` : ""}<br><small>${esc(whyItMatters(f.id))}</small></td><td>${(f.numbers ?? []).map(esc).join("<br>")}</td><td>${fix}</td></tr>`;
  }).join("")}</table>` : "<p>No findings: every check passes.</p>"}
  ${r.fyi.length ? `<h3>FYI, not a rule</h3><ul>${r.fyi.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
  <h3>Carrier</h3>
  <p>${esc(cr.reason)} ${esc(cr.runnerUp ?? "")}</p>${cr.excluded.length ? `<p>${cr.excluded.map(esc).join("<br>")}</p>` : ""}
  <p>Ready ${esc(prettyDate(c.dates.ready))} → Collection ${esc(prettyDate(c.dates.collection))} → ETA ${esc(prettyDate(c.dates.eta))}</p>
  <table><tr><th>Carrier</th><th>Total</th><th>Transit</th><th>On-time</th><th>Cap kg/pallet</th><th>Fits?</th></tr>${c.options.map((o) => `<tr><td>${esc(o.name)} (${esc(o.service)})</td><td>${gbp(o.totalCost)}</td><td>${o.transitDays} d</td><td>${o.onTimePct}%</td><td>${o.maxKgPerPallet}</td><td>${o.feasible ? "yes" : "no"}</td></tr>`).join("")}</table>
  <h3>Confirmation</h3><p>${esc(confirmation(r))}</p>
  <h3>What happens next</h3><ul>${nextSteps(r).map((s) => `<li>${s.done ? "✓ " : ""}${esc(s.text)}</li>`).join("")}</ul>
  <h3>${esc(inv.title)}</h3><table>${inv.fields.map((f) => `<tr><td>${esc(f.label)}</td><td ${f.value ? "" : 'class="blank"'}>${esc(f.value ?? "— missing —")}</td></tr>`).join("")}</table>
</section>`;
}

export function reportHtml(opts: { title: string; today: string; results: BookingResult[]; logs: ChangeLogEntry[][]; reconciliation?: string; orphans?: { row: number; bookingId: string; sku: string }[] }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(opts.title)}</title>
<style>body{font-family:Inter,Segoe UI,system-ui,sans-serif;margin:32px;color:#0B0B0C}h1{margin:0}h2{margin-top:36px;border-top:1px solid #E6E7EB;padding-top:20px}
.badge{color:#fff;border-radius:999px;padding:3px 10px;font-size:13px;vertical-align:middle}table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}
td,th{border:1px solid #E6E7EB;padding:6px;text-align:left;vertical-align:top}th{background:#F2F3F5}.blank{background:#FEF3C7}small{color:#6B7280}</style></head><body>
<h1>${esc(opts.title)}</h1><p>Generated ${esc(prettyDate(opts.today))} (Europe/London). Validation ran in the browser; rules are the fixed template Rulebook (R-01–R-10) and rate card.</p>
${opts.reconciliation ? `<p><b>Reconciliation:</b> ${esc(opts.reconciliation)}</p>` : ""}
${opts.orphans?.length ? `<p><b>Unmatched item rows (D-03):</b> ${opts.orphans.map((o) => `row ${o.row} ${esc(o.bookingId)} / ${esc(o.sku)}`).join("; ")}</p>` : ""}
${opts.results.map((r, k) => bookingSection(r, opts.logs[k] ?? [])).join("\n")}
</body></html>`;
}

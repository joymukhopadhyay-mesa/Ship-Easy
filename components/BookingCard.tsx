"use client";
// The Booking Card: verdict, change log (above the fold), fields, findings with fixes,
// carrier recommendation, confirmation, next steps, downloads and the invoice draft.
import { useState } from "react";
import type { ChangeLogEntry } from "@/lib/changelog";
import { DESTINATION_CITIES, ITEM_ORIGIN_COUNTRIES, ORIGIN_CITIES, PRIORITIES } from "@/lib/config";
import { buildContext } from "@/lib/context";
import { prettyDate, toDDMMYYYY, parseDDMMYYYY } from "@/lib/dates";
import { carrierReason, confirmation, fixText, nextSteps, VERDICT_TEXT, whyItMatters } from "@/lib/explain";
import { fmtNum, gbp, kg } from "@/lib/format";
import { invoiceDraft } from "@/lib/invoice";
import { sellerActions, type SellerAction } from "@/lib/repair";
import type { Edit } from "@/lib/session";
import type { BookingResult, Change, Env, Item, Repair, RuleResult, Weights } from "@/lib/types";
import { BoxIcon, Btn, Card, CardHeader, CheckIcon, ConfidenceChip, SeverityChip } from "./ui";
import { CarrierCards, ChangeCompare, LoadAndRoute, ShipmentHero } from "./ShipmentTop";
import { CarrierGantt, HealthMatrix, Legend, ruleName, ruleTone, TONE } from "./visuals";

export interface CardProps {
  result: BookingResult;
  log: ChangeLogEntry[];
  env: Env;
  weights: Weights;
  onWeights: (w: Weights) => void;
  onEdits: (edits: Edit[], source: "apply" | "edit" | "action" | "declaration") => void;
  onConfirmHazard: (rowId: string) => void;
  onDownloadXlsx: () => void;
  onDownloadReport: () => void;
  narrative?: string | null;
  emptyHint?: string;
  showAddPallet?: boolean;
  mode?: "chat" | "file";
}

const changeToEdit = (c: Change): Edit => {
  const map: Record<string, Edit["path"]> = {
    "booking.pallets": "pallets", "booking.cartons": "cartons", "booking.declared_value": "declaredValue", "booking.gross_weight": "grossWeight",
    "item.hs_code": "item.hsCode", "item.quantity": "item.quantity", "item.cartons": "item.cartons",
  };
  return { path: map[c.field], rowId: c.rowId, value: c.to as number };
};

function Field({ label, value, display, onCommit, type = "text", options, testId }: { label: string; value: string | number | boolean | null; display?: string; onCommit?: (v: string) => void; type?: "text" | "number" | "date" | "select"; options?: string[]; testId?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const missing = value === null || value === "" || value === undefined;
  const shown = missing ? "missing" : display ?? (typeof value === "boolean" ? (value ? "Yes" : "No") : String(value));
  const start = () => { if (!onCommit) return; setDraft(missing ? "" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)); setEditing(true); };
  const commit = (v = draft) => { setEditing(false); if (onCommit && v !== (missing ? "" : String(value))) onCommit(v); };
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      {editing ? (
        type === "select" ? (
          <select autoFocus data-testid={testId ? `${testId}-input` : undefined} className="w-full rounded-xl border border-ink px-2 py-1.5 text-sm" value={draft} onChange={(e) => commit(e.target.value)} onBlur={() => setEditing(false)}>
            <option value="">—</option>
            {options!.map((o) => <option key={o}>{o}</option>)}
          </select>
        ) : (
          <input autoFocus data-testid={testId ? `${testId}-input` : undefined} className="w-full rounded-xl border border-ink px-2 py-1.5 text-sm" type={type === "number" ? "number" : "text"} value={draft} placeholder={type === "date" ? "DD-MM-YYYY" : ""} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit()} onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} />
        )
      ) : (
        <button data-testid={testId} onClick={start} title={onCommit ? "Click to edit" : undefined} className={`w-full truncate rounded-xl px-2.5 py-1.5 text-left text-sm ${missing ? "border border-dashed border-zinc-300 text-zinc-400" : "bg-[#F4F5F7] font-medium text-ink"} ${onCommit ? "hover:ring-1 hover:ring-ink" : ""}`}>
          {shown}
        </button>
      )}
    </div>
  );
}

const asNum = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[,£\s]/g, "")));

function RepairBlock({ r, onApply }: { r: Repair; onApply: (cs: Change[]) => void }) {
  return (
    <div className="mt-2 rounded-xl bg-[#FAFAFB] p-2.5 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-2">
        <ConfidenceChip c={r.confidence} />
        {r.stage && <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Repair stage {r.stage}</span>}
      </div>
      <p className="mt-1.5 text-xs text-ink">{r.message}</p>
      {r.arithmetic.length > 0 && <ul className="mt-1 space-y-0.5">{r.arithmetic.map((a, k) => <li key={k} className="font-mono text-[11px] text-zinc-600">{a}</li>)}</ul>}
      {r.changes.length > 0 && (
        <Btn testId="apply-fix" className="mt-2" disabled={!r.applyEnabled} onClick={() => onApply(r.changes)} title={r.applyEnabled ? "Apply this fix" : "Not auto-applied: confidence is not High"}>
          {r.applyEnabled ? "Apply fix" : "Apply disabled"}
        </Btn>
      )}
    </div>
  );
}

function Finding({ rule, res, env, onApply, onAction, onConfirmHazard }: { rule: RuleResult; res: BookingResult; env: Env; onApply: (cs: Change[]) => void; onAction: (a: SellerAction) => void; onConfirmHazard: (rowId: string) => void }) {
  const repairs = res.repairs.filter((r) => r.rules.includes(rule.id));
  const actions = sellerActions(res.booking, res.rules, buildContext(res.booking, env)).filter((a) => a.rules.includes(rule.id));
  const pendingHazards = rule.id === "R-06" && rule.state === "implied" ? res.booking.items.filter((i) => (rule.itemRowIds ?? []).includes(i.rowId) && !i.hazardConfirmedAt) : [];
  return (
    <li id={`finding-${rule.id}`} data-testid={`finding-${rule.id}`} className={`scroll-mt-24 border-l-4 border-t border-t-line px-5 py-3.5 first:border-t-0 ${rule.status === "fail" ? (rule.severity === "Red" ? "border-l-bad" : "border-l-warnBright") : "border-l-zinc-300"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg bg-ink px-2 py-0.5 font-mono text-[11px] font-semibold text-white">{rule.id}</span>
        <span className={`text-sm font-semibold ${TONE[ruleTone(rule)].text}`}>{ruleName(rule.id)}</span>
        <SeverityChip severity={rule.severity} status={rule.status} />
        <span className="text-[11px] text-muted">{rule.text}</span>
      </div>
      <p className="mt-1.5 text-sm font-medium text-ink">{rule.message}</p>
      {rule.caveat && <p className="mt-1 text-xs text-warn">⚠ {rule.caveat}</p>}
      {rule.numbers && rule.numbers.length > 0 && <ul className="mt-1 space-y-0.5">{rule.numbers.map((n, k) => <li key={k} className="font-mono text-[11px] text-zinc-600">{n}</li>)}</ul>}
      {rule.status === "fail" && <p className="mt-1 text-[11px] text-muted">Why it matters: {whyItMatters(rule.id)}</p>}
      {repairs.map((r, k) => <RepairBlock key={k} r={r} onApply={onApply} />)}
      {repairs.length === 0 && rule.status !== "pass" && <p className="mt-1.5 text-xs text-ink"><b>Fix:</b> {fixText(rule, res)}</p>}
      {(actions.length > 0 || pendingHazards.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {actions.map((a) => <Btn key={a.id} testId={`action-${a.id}`} variant="light" onClick={() => onAction(a)}>{a.label}</Btn>)}
          {pendingHazards.map((i) => <Btn key={i.rowId} testId="confirm-hazard" variant="light" onClick={() => onConfirmHazard(i.rowId)}>I confirm {i.sku} has no lithium battery, aerosol or flammable liquid</Btn>)}
        </div>
      )}
    </li>
  );
}

function CarrierPanel({ res, weights, onWeights, onEdits, today }: { res: BookingResult; weights: Weights; onWeights: (w: Weights) => void; onEdits: CardProps["onEdits"]; today: string }) {
  const [showWhy, setShowWhy] = useState(false);
  const c = res.carrier;
  const cr = carrierReason(c);
  const chosen = c.options.find((o) => o.id === c.chosen);
  const rec = c.options.find((o) => o.id === c.recommended);
  const pct = (x: number) => Math.round(x * 100);
  const setW = (k: keyof Weights, v: number) => onWeights({ ...weights, [k]: v / 100 });
  return (
    <Card id="carrier">
      <CardHeader title="Carrier recommendation" subtitle={`Priority: ${c.priority}${c.priorityAssumed ? " (assumed — blank in the booking)" : ""} · lane ${c.lane ?? "unknown"}`}
        right={
          <select data-testid="carrier-picker" className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium" value={res.booking.chosenCarrier ?? ""} onChange={(e) => onEdits([{ path: "chosenCarrier", value: e.target.value || null }], "edit")}>
            <option value="">Use recommended{rec ? ` (${rec.id})` : ""}</option>
            {c.options.map((o) => <option key={o.id} value={o.id}>Seller picks {o.name}</option>)}
          </select>
        } />
      <div className="grid gap-4 p-5 md:grid-cols-[1fr_auto]">
        <div>
          {chosen ? (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{c.override ? "Seller's choice" : "Recommended"}</p>
              <p data-testid="chosen-carrier" className="text-2xl font-semibold">{chosen.name} <span className="text-base font-normal text-muted">· {chosen.service}</span></p>
              <p className="mt-1 text-3xl font-semibold">{gbp(chosen.totalCost)} <span className="text-sm font-normal text-muted">{fmtNum(res.booking.pallets)} pallets × {gbp(chosen.pricePerPallet)}</span></p>
            </>
          ) : (
            <p data-testid="chosen-carrier" className="text-xl font-semibold text-bad">No carrier can be booked yet</p>
          )}
          <p className="mt-2 text-sm text-ink">{cr.reason}</p>
          {cr.runnerUp && <p className="mt-1 text-xs text-muted">{cr.runnerUp}</p>}
          {cr.excluded.map((x, k) => <p key={k} className="mt-0.5 text-xs text-bad">{x}</p>)}
        </div>
      </div>
      <div className="mx-5 grid grid-cols-3 gap-2 rounded-2xl bg-[#FAFAFB] p-3 ring-1 ring-line">
        {[["Ready", c.dates.ready], ["Collection", c.dates.collection], ["ETA", c.dates.eta]].map(([l, d], k) => (
          <div key={l} className="relative">
            <div className="flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${d ? (k === 2 ? "bg-ok" : "bg-bad") : "bg-zinc-300"}`} /><span className="text-[10px] font-semibold uppercase tracking-wider text-muted">{l}</span></div>
            <p data-testid={`date-${String(l).toLowerCase()}`} className="mt-1 text-sm font-semibold">{prettyDate(d)}</p>
          </div>
        ))}
      </div>
      <p className="mx-5 mt-1 text-[10px] text-muted">Collection = ready date if Mon–Fri, else next Monday. ETA = collection + transit (calendar days), rolled to Monday if it lands on a weekend. UK bank holidays not modelled.</p>
      <div className="px-5 pt-4"><CarrierCards res={res} onPick={(id) => onEdits([{ path: "chosenCarrier", value: id }], "edit")} /></div>
      <div className="px-5 pt-5">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Timeline: collection → delivery for each carrier</p>
        <CarrierGantt res={res} today={today} />
      </div>
      <div className="px-5 pt-3"><button className="text-xs font-semibold text-accent" onClick={() => setShowWhy(!showWhy)}>{showWhy ? "Hide" : "Show"} how carriers are ranked {showWhy ? "▴" : "▾"}</button></div>
      <div className={showWhy ? "" : "hidden"}>
      <div className="overflow-x-auto px-5 pt-4">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead><tr className="text-muted"><th className="py-1.5">Carrier</th><th>Total</th><th>Transit</th><th>On-time</th><th>Max kg/pallet</th><th>Fits {kg(c.kgPerPallet)}/pallet?</th><th>ETA</th></tr></thead>
          <tbody>
            {c.options.map((o) => (
              <tr key={o.id} className={`border-t border-line ${o.id === c.chosen ? "font-semibold" : ""}`}>
                <td className="py-1.5">{o.name} <span className="text-muted">{o.service}</span>{o.id === c.recommended ? " ★" : ""}</td>
                <td>{gbp(o.totalCost)}</td><td>{o.transitDays} d</td><td>{o.onTimePct}%</td><td>{o.maxKgPerPallet}</td>
                <td className={o.feasible ? "text-ok" : "text-bad"}>{c.kgPerPallet == null ? "—" : o.feasible ? "Yes" : `No (min ${o.minPallets} pallets)`}</td>
                <td>{prettyDate(o.eta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5 pb-5 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Balanced score (used when priority is Balanced; 0 = best, lowest wins)</p>
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          {(["cost", "transit", "reliability"] as const).map((k) => (
            <label key={k} className="text-xs">
              <span className="flex justify-between"><span className="capitalize">{k}</span><b data-testid={`weight-${k}`}>{pct(c.weights[k])}%</b></span>
              <input aria-label={`${k} weight`} type="range" min={0} max={100} value={pct(weights[k] / (weights.cost + weights.transit + weights.reliability || 1))} onChange={(e) => setW(k, Number(e.target.value))} className="w-full accent-black" />
            </label>
          ))}
        </div>
        {c.balanced.length > 0 ? (
          <table data-testid="score-table" className="mt-2 w-full text-left text-xs">
            <thead><tr className="text-muted"><th className="py-1">Carrier</th><th>cost_n</th><th>transit_n</th><th>reliability_n</th><th>score</th></tr></thead>
            <tbody>{[...c.balanced].sort((a, b) => a.score - b.score).map((b) => (
              <tr key={b.id} className="border-t border-line"><td className="py-1">Carrier {b.id}</td><td>{b.costN.toFixed(2)}</td><td>{b.transitN.toFixed(2)}</td><td>{b.reliabilityN.toFixed(2)}</td><td className="font-semibold">{b.score.toFixed(2)}</td></tr>
            ))}</tbody>
          </table>
        ) : <p className="mt-2 text-xs text-muted">No feasible carriers to score.</p>}
        <p className="mt-1 text-[10px] text-muted">score = {pct(c.weights.cost)}% × cost_n + {pct(c.weights.transit)}% × transit_n + {pct(c.weights.reliability)}% × reliability_n, min-max normalised over the feasible carriers (if max = min the term is 0). Default 40/30/30: cost is the main concern for SME exporters; a late arrival and a missed appointment cost about the same.</p>
      </div>
      </div>
      <div className="h-5" />
    </Card>
  );
}

function ItemsTable({ items, onEdits }: { items: Item[]; onEdits: CardProps["onEdits"] }) {
  const cell = (it: Item, key: keyof Item, type: "text" | "number" | "select" = "number", options?: string[]) => (
    <Field label="" value={(it[key] as string | number | null) ?? null} type={type} options={options} testId={`item-${it.sku}-${String(key)}`}
      onCommit={(v) => onEdits([{ path: `item.${String(key)}` as Edit["path"], rowId: it.rowId, value: type === "number" ? asNum(v) : v || null }], "edit")} />
  );
  if (!items.length) return <p className="px-5 pb-4 text-sm text-zinc-400">No items yet.</p>;
  return (
    <div className="overflow-x-auto px-5 pb-4">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead><tr className="text-[10px] uppercase tracking-wider text-muted"><th className="pb-1">SKU / description</th><th>HS code</th><th>Qty</th><th>Unit £</th><th>Units/ctn</th><th>Cartons</th><th>Unit kg</th><th>Origin</th></tr></thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.rowId} className="align-top">
              <td className="py-1 pr-2"><p className="font-semibold">{it.sku}</p><p className="text-muted">{it.description}</p></td>
              <td className="w-24 pr-1">{cell(it, "hsCode", "text")}</td>
              <td className="w-20 pr-1">{cell(it, "quantity")}</td>
              <td className="w-16 pr-1">{cell(it, "unitPrice")}</td>
              <td className="w-16 pr-1">{cell(it, "unitsPerCarton")}</td>
              <td className="w-16 pr-1">{cell(it, "cartons")}</td>
              <td className="w-16 pr-1">{cell(it, "unitWeight")}</td>
              <td className="w-28">{cell(it, "countryOfOrigin", "select", [...ITEM_ORIGIN_COUNTRIES])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BookingCard(p: CardProps) {
  const { result: res, env } = p;
  const b = res.booking;
  const c = res.carrier;
  const [showPassed, setShowPassed] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const ORDER = { fail: 0, cannot_compute: 1, not_checked: 1, pass: 2 } as const;
  const findings = res.rules.filter((r) => r.status !== "pass").sort((x, y) => ORDER[x.status] - ORDER[y.status] || (x.severity === y.severity ? 0 : x.severity === "Red" ? -1 : 1));
  const passed = res.rules.filter((r) => r.status === "pass");
  const inv = invoiceDraft(b);
  const edit = (path: Edit["path"], value: Edit["value"]) => p.onEdits([{ path, value }], "edit");
  const apply = (cs: Change[]) => p.onEdits(cs.map(changeToEdit), "apply");
  const act = (a: SellerAction) => {
    const edits: Edit[] = (a.changes ?? []).map(changeToEdit);
    if (a.setCarrier !== undefined) edits.push({ path: "chosenCarrier", value: a.setCarrier });
    if (a.setAppointment !== undefined) edits.push({ path: "appointmentBooked", value: a.setAppointment });
    p.onEdits(edits, "action");
  };

  return (
    <div className="space-y-4" data-testid="booking-card">
      <ShipmentHero res={res} mode={p.mode ?? "file"} />
      <ChangeCompare log={p.log} />
      <Card className="anim-fade-up p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div><h3 className="text-[15px] font-semibold">Shipment health · the 10 checks</h3><p className="text-xs text-muted">Green = OK · Amber = check before shipping · Red = must fix · Grey = waiting for details. Tap a tile to see the fix.</p></div>
          <p className="text-xs text-muted"><b className="text-ink">{res.rules.filter((r) => r.status === "pass").length}/10</b> passing</p>
        </div>
        <HealthMatrix res={res} onPick={(id) => document.getElementById(`finding-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })} />
      </Card>
      <Card id="findings">
        <CardHeader title="What to fix" subtitle="Each problem: the rule, what's wrong, how serious, the numbers, and the fix with a confidence label. Red = must fix · Amber = check." />
        {res.gate.length > 0 && (
          <ul className="mx-5 mt-3 space-y-1 rounded-2xl bg-zinc-50 p-3 ring-1 ring-line">
            {res.gate.map((g, k) => <li key={k} className="text-xs"><span className="mr-1.5 rounded bg-zinc-700 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">{g.code}</span>{g.message}</li>)}
          </ul>
        )}
        {findings.length ? (
          <ul className="mt-2">{findings.map((r) => <Finding key={r.id} rule={r} res={res} env={env} onApply={apply} onAction={act} onConfirmHazard={p.onConfirmHazard} />)}</ul>
        ) : (
          <p className="px-5 py-4 text-sm font-medium text-ok">No findings: every check passes.</p>
        )}
        <div className="border-t border-line px-5 py-3">
          <button className="text-xs font-semibold text-ink" onClick={() => setShowPassed(!showPassed)}>{passed.length} checks passed {showPassed ? "▴" : "▾"}</button>
          {showPassed && <ul className="mt-2 space-y-1">{passed.map((r) => <li key={r.id} className="text-xs text-muted"><span className="font-mono font-semibold text-ok">{r.id} ✓</span> {r.message}{r.numbers?.length ? <span className="font-mono text-[10px]"> — {r.numbers.join(" · ")}</span> : null}</li>)}</ul>}
        </div>
        {res.fyi.length > 0 && (
          <div className="border-t border-line px-5 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">FYI, not a rule (never changes the verdict)</p>
            <ul className="mt-1 list-disc pl-4">{res.fyi.map((f, k) => <li key={k} className="text-xs text-muted">{f}</li>)}</ul>
          </div>
        )}
      </Card>

      <LoadAndRoute res={res} />

      <CarrierPanel res={res} weights={p.weights} onWeights={p.onWeights} onEdits={p.onEdits} today={env.today} />

      <Card>
        <CardHeader title="Booking details" subtitle="Filled fields are solid, missing ones are outlined. Click any value to edit; every edit re-runs the checks." right={p.showAddPallet ? <Btn testId="add-pallet" onClick={() => edit("pallets", (b.pallets ?? 0) + 1)}>+ Add a pallet</Btn> : undefined} />
        <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-4">
          <Field label="Origin" value={b.originCity} type="select" options={[...ORIGIN_CITIES]} onCommit={(v) => edit("originCity", v || null)} testId="f-origin" />
          <Field label="Destination" value={b.destinationCity} display={b.destinationCity ? `${b.destinationCity}${b.destinationCountry ? ", " + b.destinationCountry : ""}` : undefined} type="select" options={Object.keys(DESTINATION_CITIES)} onCommit={(v) => edit("destinationCity", v || null)} testId="f-destination" />
          <Field label="Destination type" value={b.destinationType} type="select" options={["Warehouse", "Business address"]} onCommit={(v) => edit("destinationType", v || null)} testId="f-desttype" />
          <Field label="Ready date" value={b.readyDate} display={b.readyDate ? `${toDDMMYYYY(b.readyDate)} (${prettyDate(b.readyDate).slice(0, 3)})` : undefined} type="date" onCommit={(v) => { const iso = parseDDMMYYYY(v); if (iso || !v) edit("readyDate", iso); }} testId="f-ready" />
          <Field label="Priority" value={b.priority} type="select" options={PRIORITIES} onCommit={(v) => edit("priority", v || null)} testId="f-priority" />
          <Field label="Pallets" value={b.pallets} type="number" onCommit={(v) => edit("pallets", asNum(v))} testId="f-pallets" />
          <Field label="Gross weight (kg)" value={b.grossWeight} type="number" onCommit={(v) => edit("grossWeight", asNum(v))} testId="f-gross" />
          <Field label="Delivery appointment" value={b.appointmentBooked} type="select" options={["Yes", "No"]} onCommit={(v) => edit("appointmentBooked", v === "" ? null : v === "Yes")} testId="f-appt" />
          <Field label="Cartons (booking)" value={b.cartons} type="number" onCommit={(v) => edit("cartons", asNum(v))} testId="f-cartons" />
          <Field label="Declared value (GBP)" value={b.declaredValue} display={b.declaredValue != null ? gbp(b.declaredValue) : undefined} type="number" onCommit={(v) => edit("declaredValue", asNum(v))} testId="f-value" />
          <Field label="Origin country" value={b.originCountry} />
          <Field label="Currency" value={b.currency} />
        </div>
        <ItemsTable items={b.items} onEdits={p.onEdits} />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Confirmation" subtitle="Your shipment, in plain English" />
          <p data-testid="confirmation" className="px-5 pb-5 pt-3 text-sm leading-relaxed">{confirmation(res)}</p>
          {p.narrative && <p className="mx-5 mb-5 rounded-xl bg-violet-50 p-3 text-xs text-ink"><b>Explanation (AI voice):</b> {p.narrative}</p>}
        </Card>
        <Card>
          <CardHeader title="What happens next" />
          <ul className="space-y-2 px-5 pb-5 pt-3">
            {nextSteps(res).map((s, k) => (
              <li key={k} className="flex gap-2 text-sm"><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${s.done ? "bg-ok text-white" : "ring-1 ring-zinc-300"}`}>{s.done ? <CheckIcon className="h-3 w-3" /> : null}</span>{s.text}</li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader title="Downloads" subtitle="Generated in your browser" />
        <div className="flex flex-wrap gap-2 p-5">
          <Btn testId="dl-xlsx" onClick={p.onDownloadXlsx}><BoxIcon className="h-4 w-4" /> Corrected .xlsx</Btn>
          <Btn testId="dl-report" variant="light" onClick={p.onDownloadReport}>Pre-flight report (.html)</Btn>
          <Btn testId="toggle-invoice" variant="light" onClick={() => setShowInvoice(!showInvoice)}>{showInvoice ? "Hide" : "Show"} invoice draft</Btn>
        </div>
        {showInvoice && (
          <div className="px-5 pb-5">
            <p data-testid="invoice-title" className="text-sm font-semibold">{inv.title}</p>
            <p className="text-xs text-muted">The booking sheet doesn't carry everything customs needs — a root cause of the holds this tool exists to prevent. Highlighted fields must be added before export.</p>
            <table className="mt-2 w-full text-left text-xs">
              <tbody>{inv.fields.map((f) => <tr key={f.label} className="border-t border-line"><td className="w-56 py-1.5 font-medium">{f.label}</td><td className={f.value ? "" : "bg-amber-50 font-semibold text-warn"}>{f.value ?? "— missing —"}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

"use client";
// Overview dashboard (reference image 1): KPIs, weight-per-pallet chart, readiness gauge,
// route map, upcoming collections and the shipments table with status filters and flags.
import { useMemo, useState } from "react";
import { prettyDate } from "@/lib/dates";
import { fmtNum, gbp } from "@/lib/format";
import type { BookingResult, Verdict } from "@/lib/types";
import { Card } from "./ui";
import { Chip, Dot, Gauge, Icon, Legend, RouteMap, Stat, StatusPill, TONE, VehicleImg, VERDICT_LABEL, VERDICT_TONE, WeightChart, ruleName, ruleTone, type Tone } from "./visuals";

export interface Row {
  key: string;
  source: "chat" | "file";
  result: BookingResult;
  edits: number;
}

type Filter = "ALL" | Verdict;
type SortKey = "id" | "status" | "price" | "eta";
const ORDER: Record<Verdict, number> = { BLOCKED: 0, INCOMPLETE: 1, "SHIP WITH CARE": 2, "CLEAR TO SHIP": 3 };

export function Overview({ rows, onOpen, onSample, onChatDemo, onUpload, reconciliation }: {
  rows: Row[];
  onOpen: (key: string) => void;
  onSample: () => void;
  onChatDemo: () => void;
  onUpload: () => void;
  reconciliation: string | null;
}) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "status", dir: 1 });
  const count = (v: Verdict) => rows.filter((r) => r.result.verdict === v).length;
  const total = rows.length;
  const ready = count("CLEAR TO SHIP") + count("SHIP WITH CARE");
  const value = rows.reduce((s, r) => s + (r.result.booking.declaredValue ?? 0), 0);
  const readyValue = rows.filter((r) => ["CLEAR TO SHIP", "SHIP WITH CARE"].includes(r.result.verdict)).reduce((s, r) => s + (r.result.booking.declaredValue ?? 0), 0);
  const pct = (n: number) => (total ? `${Math.round((n / total) * 100)}%` : "0%");

  const shown = useMemo(() => {
    const list = rows.filter((r) => filter === "ALL" || r.result.verdict === filter);
    const price = (r: Row) => r.result.carrier.options.find((o) => o.id === r.result.carrier.chosen)?.totalCost ?? Infinity;
    const cmp: Record<SortKey, (a: Row, b: Row) => number> = {
      id: (a, b) => a.result.booking.bookingId.localeCompare(b.result.booking.bookingId),
      status: (a, b) => ORDER[a.result.verdict] - ORDER[b.result.verdict] || a.result.booking.bookingId.localeCompare(b.result.booking.bookingId),
      price: (a, b) => price(a) - price(b),
      eta: (a, b) => (a.result.carrier.dates.eta ?? "9").localeCompare(b.result.carrier.dates.eta ?? "9"),
    };
    return [...list].sort((a, b) => cmp[sort.k](a, b) * sort.dir);
  }, [rows, filter, sort]);

  if (!total) {
    return (
      <div className="space-y-5">
        <Card className="anim-fade-up overflow-hidden">
          <div className="grid items-center gap-4 p-6 md:grid-cols-[1.2fr_1fr] md:p-8">
            <div>
              <Chip tone="accent"><Icon name="spark" className="h-3 w-3" /> Pre-flight check for UK → EU freight</Chip>
              <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight md:text-4xl">Catch booking mistakes<br />before your shipment leaves.</h2>
              <p className="mt-3 max-w-lg text-sm text-muted">Describe a shipment in plain words or upload your Bookings & Items sheets. Ship Easy checks it against the 10 rules, shows exactly what's wrong and how to fix it, and picks the right carrier for your priority.</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <button data-testid="cta-sample" onClick={onSample} className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800">Load sample file</button>
                <button data-testid="cta-chat" onClick={onChatDemo} className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Try a chat demo</button>
                <button onClick={onUpload} className="rounded-full bg-white px-4 py-2 text-sm font-semibold ring-1 ring-line hover:bg-zinc-50">Upload your sheets</button>
              </div>
            </div>
            <VehicleImg src="/img/truck-hero.png" alt="Truck" className="anim-drive h-48 w-full" />
          </div>
        </Card>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { n: "1", icon: "chat", t: "Tell us or upload", d: "Type “600 skillets to Hamburg”, or drop your .xlsx. We ask only for what's missing." },
            { n: "2", icon: "grid", t: "We run 10 checks", d: "HS codes, values, carton maths, pallet weight, dangerous goods, dates… each one shown as a coloured tile." },
            { n: "3", icon: "truck", t: "Fix, pick a carrier, go", d: "One-click fixes where we're sure, the best carrier for your priority, and dates from collection to delivery." },
          ].map((s, k) => (
            <Card key={s.n} className="anim-fade-up p-5" >
              <div className="flex items-center gap-3" style={{ animationDelay: `${k * 80}ms` }}>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accentSoft text-accent"><Icon name={s.icon} /></span>
                <p className="text-sm font-semibold">{s.n}. {s.t}</p>
              </div>
              <p className="mt-2 text-sm text-muted">{s.d}</p>
            </Card>
          ))}
        </div>
        <Card className="p-5"><p className="mb-3 text-sm font-semibold">How to read the colours</p><Legend /></Card>
      </div>
    );
  }

  const nextUp = rows.filter((r) => r.result.carrier.dates.collection).sort((a, b) => a.result.carrier.dates.collection!.localeCompare(b.result.carrier.dates.collection!)).slice(0, 4);
  const pills: { f: Filter; label: string; n: number; tone?: Tone }[] = [
    { f: "ALL", label: "All shipments", n: total },
    { f: "BLOCKED", label: "Blocked", n: count("BLOCKED"), tone: "bad" },
    { f: "SHIP WITH CARE", label: "Ship with care", n: count("SHIP WITH CARE"), tone: "warn" },
    { f: "CLEAR TO SHIP", label: "Clear", n: count("CLEAR TO SHIP"), tone: "ok" },
    { f: "INCOMPLETE", label: "Incomplete", n: count("INCOMPLETE"), tone: "grey" },
  ];
  const th = (k: SortKey, label: string) => (
    <th className="cursor-pointer select-none py-2 pr-3 font-medium" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : 1 }))}>{label} <span className="text-zinc-300">{sort.k === k ? (sort.dir === 1 ? "▲" : "▼") : "⇅"}</span></th>
  );

  return (
    <div className="space-y-5" data-testid="overview">
      <Card className="p-5">
        <div className="grid grid-cols-2 gap-5 md:grid-cols-5">
          <Stat testId="kpi-total" icon="boxes" value={total} label="Shipments checked" chip={reconciliation ? "file" : undefined} chipTone="accent" />
          <Stat testId="kpi-clear" icon="check" value={count("CLEAR TO SHIP")} label="Clear to ship" chip={pct(count("CLEAR TO SHIP"))} chipTone="ok" delay={60} />
          <Stat testId="kpi-care" icon="alert" value={count("SHIP WITH CARE")} label="Ship with care" chip={pct(count("SHIP WITH CARE"))} chipTone="warn" delay={120} />
          <Stat testId="kpi-blocked" icon="x" value={count("BLOCKED")} label="Blocked" chip={pct(count("BLOCKED"))} chipTone="bad" delay={180} />
          <Stat testId="kpi-incomplete" icon="clock" value={count("INCOMPLETE")} label="Incomplete" chip={pct(count("INCOMPLETE"))} chipTone="grey" delay={240} />
        </div>
        {reconciliation && <p data-testid="reconciliation-overview" className="mt-4 inline-flex rounded-full bg-[#F4F5F7] px-3 py-1 font-mono text-[11px] font-semibold">{reconciliation}</p>}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr] [&>*]:min-w-0">
        <Card className="anim-fade-up p-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div><h3 className="text-[15px] font-semibold">Weight per pallet vs carrier limit</h3><p className="text-xs text-muted">Black = kg per pallet (red if no carrier will take it) · blue = chosen carrier's limit · dashed = each carrier's maximum</p></div>
            <div className="flex gap-3 text-[11px]"><span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-ink" /> kg / pallet</span><span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-sky" /> limit</span></div>
          </div>
          <WeightChart onPick={onOpen} rows={rows.map((r) => {
            const c = r.result.carrier;
            const o = c.options.find((x) => x.id === c.chosen);
            return { id: r.key, label: r.result.booking.bookingId.replace(/^BK-/, ""), kg: c.kgPerPallet, cap: o?.maxKgPerPallet ?? null, tone: (c.r05 === "pass" ? "ok" : c.r05 === "cannot_compute" ? "grey" : "bad") as Tone };
          })} />
        </Card>
        <Card className="anim-fade-up p-5">
          <h3 className="text-[15px] font-semibold">Ready to ship</h3>
          <p className="text-xs text-muted">Shipments that are clear or ship-with-care</p>
          <div className="mt-4"><Gauge value={ready} max={total} label={`${ready} of ${total}`} sub={`${gbp(readyValue)} of ${gbp(value)} cargo value`} /></div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            {(["BLOCKED", "INCOMPLETE"] as Verdict[]).map((v) => (
              <button key={v} onClick={() => setFilter(v)} className={`flex items-center justify-between rounded-xl px-3 py-2 ${TONE[VERDICT_TONE[v]].bg}`}><span className="flex items-center gap-1.5"><Dot tone={VERDICT_TONE[v]} /> {VERDICT_LABEL[v]}</span><b>{count(v)}</b></button>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.7fr_1fr] [&>*]:min-w-0">
        <Card className="anim-fade-up p-5">
          <div className="mb-3"><h3 className="text-[15px] font-semibold">Routes</h3><p className="text-xs text-muted">Every shipment from its UK collection city; colour shows its status</p></div>
          <RouteMap height={300} routes={rows.map((r) => ({ id: r.key, from: r.result.booking.originCity, to: r.result.booking.destinationCity, tone: VERDICT_TONE[r.result.verdict] }))} />
        </Card>
        <Card className="anim-fade-up p-5">
          <h3 className="text-[15px] font-semibold">Next collections</h3>
          <p className="text-xs text-muted">Soonest first</p>
          <VehicleImg src="/img/truck-box.png" alt="Box truck" className="anim-drive mx-auto my-2 h-24 w-full" />
          <ol className="relative mt-1 space-y-3 border-l-2 border-dashed border-zinc-200 pl-4">
            {nextUp.map((r) => {
              const t = VERDICT_TONE[r.result.verdict];
              return (
                <li key={r.key} className="relative">
                  <span className={`absolute -left-[23px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${TONE[t].solid}`} />
                  <button onClick={() => onOpen(r.key)} className="w-full text-left">
                    <div className="flex items-center justify-between text-xs"><b>{r.result.booking.bookingId}</b><span className="text-muted">{prettyDate(r.result.carrier.dates.collection).slice(0, 10)}</span></div>
                    <p className="text-[11px] text-muted">{r.result.booking.originCity ?? "?"} → {r.result.booking.destinationCity ?? "?"} · <span className={TONE[t].text}>{VERDICT_LABEL[r.result.verdict]}</span></p>
                  </button>
                </li>
              );
            })}
            {!nextUp.length && <li className="text-xs text-muted">No collection dates yet.</li>}
          </ol>
        </Card>
      </div>

      <Card className="anim-fade-up p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="text-[15px] font-semibold">Shipments</h3><p className="text-xs text-muted">Tap a row to open its full check. Flags show which rules failed.</p></div>
          <div className="flex flex-wrap rounded-full bg-[#F4F5F7] p-1">
            {pills.map((p) => (
              <button key={p.f} data-testid={`filter-${p.f}`} onClick={() => setFilter(p.f)} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${filter === p.f ? "bg-ink text-white" : "text-ink hover:bg-white"}`}>
                {p.tone && <Dot tone={p.tone} />}{p.label}<span className={`rounded-full px-1.5 text-[10px] ${filter === p.f ? "bg-white/20" : "bg-white"}`}>{p.n}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table data-testid="shipments-table" className="w-full min-w-[920px] text-left text-xs">
            <thead><tr className="border-b border-line text-muted">{th("id", "Booking")}<th className="py-2 pr-3 font-medium">Goods</th><th className="py-2 pr-3 font-medium">Route</th><th className="py-2 pr-3 font-medium">Load</th>{th("price", "Carrier · price")}{th("eta", "Collection → ETA")}<th className="py-2 pr-3 font-medium">Flags</th>{th("status", "Status")}</tr></thead>
            <tbody>
              {shown.map((r, k) => {
                const b = r.result.booking;
                const c = r.result.carrier;
                const o = c.options.find((x) => x.id === c.chosen);
                const flags = r.result.rules.filter((x) => x.status === "fail");
                return (
                  <tr key={r.key} data-testid={`row-${b.bookingId}`} onClick={() => onOpen(r.key)} className="anim-fade-up cursor-pointer border-b border-line/70 transition hover:bg-[#F8F8FA]" style={{ animationDelay: `${Math.min(k, 12) * 30}ms` }}>
                    <td className="py-3 pr-3"><p className="font-semibold">{b.bookingId}{b.duplicateOf ? " (dup.)" : ""}</p><p className="text-[11px] text-muted">{r.source === "chat" ? "From chat" : b.sellerName ?? "—"}</p></td>
                    <td className="max-w-[180px] truncate py-3 pr-3">{b.items[0]?.description || "—"}{b.items.length > 1 ? <span className="text-muted"> +{b.items.length - 1}</span> : null}</td>
                    <td className="py-3 pr-3 whitespace-nowrap">{b.originCity ?? "?"} <span className="text-muted">→</span> {b.destinationCity ?? "?"}</td>
                    <td className="py-3 pr-3 whitespace-nowrap">{b.pallets ?? "?"} pal · <span className={c.r05 === "pass" ? "" : c.r05 === "cannot_compute" ? "text-grey" : "font-semibold text-bad"}>{c.kgPerPallet == null ? "—" : `${fmtNum(Math.round(c.kgPerPallet))} kg/pal`}</span></td>
                    <td className="py-3 pr-3 whitespace-nowrap">{o ? <>{o.name} · <b>{gbp(o.totalCost)}</b></> : <span className="text-bad">None</span>}</td>
                    <td className="py-3 pr-3 whitespace-nowrap">{c.dates.collection ? `${prettyDate(c.dates.collection).slice(0, 10)} → ${c.dates.eta ? prettyDate(c.dates.eta).slice(4, 10) : "—"}` : "—"}</td>
                    <td className="py-3 pr-3"><div className="flex max-w-[220px] flex-wrap gap-1">{flags.length ? flags.map((f) => <Chip key={f.id} tone={ruleTone(f)}>{ruleName(f.id)}</Chip>) : r.result.gate.length ? <Chip tone="grey">{r.result.gate[0].code} data</Chip> : <span className="text-ok">✓ none</span>}</div></td>
                    <td className="py-3"><StatusPill verdict={r.result.verdict} size="sm" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!shown.length && <p className="py-6 text-center text-sm text-muted">No shipments with this status.</p>}
          <p className="mt-2 text-right text-[11px] text-muted">{shown.length ? `1–${shown.length} of ${shown.length}` : ""}</p>
        </div>
      </Card>
    </div>
  );
}

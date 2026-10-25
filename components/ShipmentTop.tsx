"use client";
// Top of a shipment's page, modelled on the reference video's shipment view: hero card with the
// truck, route and dates, the before/now comparison, and the load + route visuals.
import { useState } from "react";
import type { ChangeLogEntry } from "@/lib/changelog";
import { prettyDate } from "@/lib/dates";
import { tradeOff, VERDICT_TEXT } from "@/lib/explain";
import { fmtNum, gbp } from "@/lib/format";
import type { BookingResult, CarrierId } from "@/lib/types";
import { Card } from "./ui";
import { CARRIER_IMG, Chip, Icon, RouteMap, RouteTrack, StatusPill, TONE, TruckLoad, VehicleImg, VERDICT_LABEL, VERDICT_TONE, type Tone } from "./visuals";

function Callout({ label, value, tone, className = "" }: { label: string; value: string; tone?: Tone; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white/90 px-3 py-2 shadow-card ring-1 ring-line backdrop-blur ${className}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className={`text-sm font-semibold ${tone ? TONE[tone].text : ""}`}>{value}</p>
    </div>
  );
}

/** Hero card: what is this shipment, where is it going, is it OK — readable in 3 seconds. */
export function ShipmentHero({ res, mode }: { res: BookingResult; mode: "chat" | "file" }) {
  const b = res.booking;
  const c = res.carrier;
  const chosen = c.options.find((o) => o.id === c.chosen) ?? null;
  const t = VERDICT_TONE[res.verdict];
  const reds = res.rules.filter((r) => r.status === "fail" && r.severity === "Red").length;
  const ambers = res.rules.filter((r) => r.status === "fail" && r.severity === "Amber").length;
  const passed = res.rules.filter((r) => r.status === "pass").length;
  const goods = b.items.length ? `${b.items.length === 1 ? `${fmtNum(b.items[0].quantity)} × ${b.items[0].description || b.items[0].sku}` : `${b.items.length} products`}` : "No goods yet";
  return (
    <Card className={`anim-fade-up overflow-hidden ring-2 ${TONE[t].ring}`}>
      <div className={`h-1.5 w-full ${TONE[t].solid}`} />
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">{mode === "chat" ? "Shipment from chat" : "Shipment from your file"} · {b.bookingId}{b.sellerName ? ` · ${b.sellerName}` : ""}</p>
          <h2 className="mt-1 flex flex-wrap items-center gap-2 text-[26px] font-semibold leading-tight tracking-tight">
            <span>{b.originCity ?? "UK"}</span>
            <Icon name="arrow" className="h-6 w-6 text-muted" />
            <span>{b.destinationCity ?? "Destination?"}</span>
            {c.lane && <span className="text-base font-normal text-muted">{c.lane}</span>}
          </h2>
          <p className="mt-1 text-sm text-muted">{goods}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusPill verdict={res.verdict} size="lg" />
          <p className={`max-w-[260px] text-right text-xs ${TONE[t].text}`}>{VERDICT_TEXT[res.verdict].split(":")[1]?.trim() ?? VERDICT_TEXT[res.verdict]}</p>
        </div>
      </div>

      <div className="grid gap-3 px-5 pt-3 md:grid-cols-[1fr_1.6fr_1fr]">
        <div className="order-2 grid grid-cols-2 gap-2 md:order-1 md:grid-cols-1">
          <Callout label="Pallets · weight" value={`${b.pallets ?? "?"} · ${b.grossWeight != null ? fmtNum(b.grossWeight) + " kg" : "? kg"}`} />
          <Callout label="Weight per pallet" value={c.kgPerPallet == null ? "—" : `${fmtNum(Math.round(c.kgPerPallet))} kg`} tone={c.r05 === "pass" ? undefined : c.r05 === "cannot_compute" ? "grey" : "bad"} />
          <Callout label="Cargo value" value={gbp(b.declaredValue)} />
        </div>
        <div className="order-1 flex items-center justify-center md:order-2">
          <VehicleImg src={chosen ? CARRIER_IMG[chosen.id].src : "/img/truck-hero.png"} alt={chosen ? CARRIER_IMG[chosen.id].alt : "Truck"} className="anim-drive h-36 w-full max-w-[360px] md:h-44" />
        </div>
        <div className="order-3 grid grid-cols-2 gap-2 md:grid-cols-1">
          <Callout label="Carrier" value={chosen ? `${chosen.name} · ${gbp(chosen.totalCost)}` : "None can take it yet"} tone={chosen ? undefined : "bad"} />
          <Callout label="Collection → ETA" value={c.dates.collection ? `${prettyDate(c.dates.collection).slice(0, 10)} → ${c.dates.eta ? prettyDate(c.dates.eta).slice(0, 10) : "—"}` : "—"} />
          <Callout label="Checks" value={`${passed}/10 OK${reds ? ` · ${reds} red` : ""}${ambers ? ` · ${ambers} amber` : ""}`} tone={reds ? "bad" : ambers ? "warn" : passed === 10 ? "ok" : "grey"} />
        </div>
      </div>
      <div className="px-5 pb-5"><RouteTrack res={res} /></div>
    </Card>
  );
}

const SIDE = (line: string, side: 0 | 1) => {
  const p = line.split(" -> ");
  return p.length === 2 ? p[side] : side === 1 ? line : "";
};

/** Before vs now (video: "current" vs "proposed" panel). Keeps the full append-only history. */
const isDetail = (l: string) => !/^R-\d|^Carrier |^Weight\/pallet|^No checks|^Items /.test(l);

export function ChangeCompare({ log }: { log: ChangeLogEntry[] }) {
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const last = log[log.length - 1];
  // Many filled-in fields (first chat turns) are folded so the checks that flipped stay visible.
  const many = last ? last.lines.filter(isDetail).length > 5 : false;
  const lines = last ? (many && !details ? last.lines.filter((l) => !isDetail(l)) : last.lines) : [];
  return (
    <Card className="anim-fade-up">
      <div data-testid="changelog" className="p-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted"><Icon name="spark" className="h-4 w-4 text-accent" /> Change log {log.length ? `· ${log.length} edit${log.length > 1 ? "s" : ""}` : ""}</p>
          {log.length > 1 && <button className="text-[11px] font-semibold text-accent" onClick={() => setOpen(!open)}>{open ? "Hide history" : "Show history"}</button>}
        </div>
        {!last ? (
          <p className="mt-1 text-xs text-muted">No changes yet. Edit anything (or tell the chat) and you'll see what it was, what it is now, and which checks flipped.</p>
        ) : (
          <>
            <p className="mt-1 text-[11px] text-muted">{last.at} (Europe/London)</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded-2xl bg-[#F6F7F9] p-3 ring-1 ring-line">
                <div className="flex items-center justify-between"><p className="text-[11px] font-semibold text-muted">Before</p><StatusPill verdict={last.verdictFrom} size="sm" /></div>
                <ul className="mt-2 space-y-1">
                  {lines.filter((l) => l.includes(" -> ")).map((l, k) => <li key={k} className="text-xs text-muted line-through decoration-zinc-300">{SIDE(l, 0)}</li>)}
                </ul>
              </div>
              <div className="rounded-2xl bg-accentSoft p-3 ring-1 ring-accent/20">
                <div className="flex items-center justify-between"><p className="text-[11px] font-semibold text-accent">Now</p><StatusPill verdict={last.verdictTo} size="sm" /></div>
                <ul className="mt-2 space-y-1">
                  {many && <li><button className="text-xs font-semibold text-accent" onClick={() => setDetails(!details)}>{details ? "Hide" : "Show"} {last.lines.filter(isDetail).length} details filled in</button></li>}
                  {lines.map((l, k) => {
                    const [from, to] = l.split(" -> ");
                    const good = /-> Pass$/.test(l), bad = /-> (Red|Amber)/.test(l);
                    return (
                      <li key={k} className={`text-xs ${good ? "text-ok" : bad ? "text-bad" : "text-ink"}`}>
                        {to !== undefined ? <>{from} <span className="text-muted">→</span> <b>{to}</b></> : <b>{l}</b>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
            {open && (
              <ol className="mt-3 space-y-1 border-t border-line pt-2">
                {log.slice(0, -1).reverse().map((e, k) => (
                  <li key={k} className="text-[11px] text-muted"><span className="font-semibold text-ink">{e.at}</span> · {e.lines.join(" | ")}</li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

/** Load (reference image 2) and route map (video) side by side. */
export function LoadAndRoute({ res }: { res: BookingResult }) {
  const t = VERDICT_TONE[res.verdict];
  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Card className="anim-fade-up p-5">
        <div className="flex items-center justify-between">
          <div><h3 className="text-[15px] font-semibold">Truck load</h3><p className="text-xs text-muted">Each square is one pallet, coloured by weight against the carrier's limit</p></div>
          <Chip tone={res.carrier.r05 === "pass" ? "ok" : res.carrier.r05 === "cannot_compute" ? "grey" : "bad"}>R-05 {res.carrier.r05 === "pass" ? "OK" : res.carrier.r05 === "cannot_compute" ? "waiting" : "over limit"}</Chip>
        </div>
        <div className="mt-4"><TruckLoad res={res} /></div>
      </Card>
      <Card className="anim-fade-up p-5" >
        <div className="flex items-center justify-between">
          <div><h3 className="text-[15px] font-semibold">Route</h3><p className="text-xs text-muted">UK collection → delivery city. Line colour = status</p></div>
          <Chip tone={t}>{VERDICT_LABEL[res.verdict]}</Chip>
        </div>
        <div className="mt-4"><RouteMap routes={[{ id: res.booking.bookingId, from: res.booking.originCity, to: res.booking.destinationCity, tone: t, active: true }]} height={230} /></div>
      </Card>
    </div>
  );
}

/** Carrier choices as vehicle cards (video "live tracking" cards + reference image 1 vehicle card). */
export function CarrierCards({ res, onPick }: { res: BookingResult; onPick: (id: CarrierId | null) => void }) {
  const c = res.carrier;
  const per = c.kgPerPallet;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {c.options.map((o, k) => {
        const chosen = o.id === c.chosen;
        const rec = o.id === c.recommended;
        const tooHeavy = per != null && !o.feasible;
        const pct = per == null ? 0 : Math.round((per / o.maxKgPerPallet) * 100);
        const chosenOpt = c.options.find((x) => x.id === c.chosen);
        return (
          <div key={o.id} data-testid={`carrier-card-${o.id}`} className={`anim-fade-up relative flex flex-col rounded-2xl bg-white p-3 ring-1 transition ${chosen ? "ring-2 ring-accent shadow-lift" : "ring-line"}`} style={{ animationDelay: `${k * 80}ms` }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">{o.name}</p>
                <p className="text-[11px] text-muted">{o.service}</p>
              </div>
              {tooHeavy ? <Chip tone="bad">Too heavy</Chip> : chosen ? <Chip tone="accent">{c.override ? "Your pick" : "Recommended"}</Chip> : rec ? <Chip tone="accent">Recommended</Chip> : <Chip tone="grey">Option</Chip>}
            </div>
            <VehicleImg src={CARRIER_IMG[o.id].src} alt={CARRIER_IMG[o.id].alt} className={`my-2 h-20 w-full ${tooHeavy ? "opacity-40 grayscale" : ""}`} />
            <div className="grid grid-cols-3 gap-1 text-center">
              <div><p className="text-sm font-semibold">{gbp(o.totalCost)}</p><p className="text-[10px] text-muted">total</p></div>
              <div><p className="text-sm font-semibold">{o.transitDays} days</p><p className="text-[10px] text-muted">transit</p></div>
              <div><p className="text-sm font-semibold">{o.onTimePct}%</p><p className="text-[10px] text-muted">on time</p></div>
            </div>
            <div className="mt-2">
              <div className="flex justify-between text-[10px] text-muted"><span>Load per pallet</span><span className={tooHeavy ? "font-semibold text-bad" : ""}>{per == null ? "—" : `${fmtNum(Math.round(per))} / ${o.maxKgPerPallet} kg`}</span></div>
              <div className="mt-1 h-1.5 rounded-full bg-zinc-100"><div className={`anim-grow-x h-full rounded-full ${tooHeavy ? "bg-bad" : chosen ? "bg-accent" : "bg-ink/70"}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
            </div>
            <p className="mt-2 text-[11px] text-muted">{tooHeavy ? `Needs at least ${o.minPallets} pallets` : chosen ? `ETA ${prettyDate(o.eta)}` : chosenOpt ? `vs ${chosenOpt.id}: ${tradeOff(chosenOpt, o)}` : `ETA ${prettyDate(o.eta)}`}</p>
            {!chosen && !tooHeavy && <button data-testid={`pick-${o.id}`} onClick={() => onPick(o.id)} className="mt-2 rounded-full bg-ink px-3 py-1 text-[11px] font-semibold text-white hover:bg-zinc-800">Use {o.name}</button>}
            {chosen && c.override && <button onClick={() => onPick(null)} className="mt-2 rounded-full bg-white px-3 py-1 text-[11px] font-semibold ring-1 ring-line hover:bg-zinc-50">Back to recommended</button>}
          </div>
        );
      })}
      {!c.options.length && <p className="text-sm text-muted">Carriers appear once the destination is known.</p>}
    </div>
  );
}

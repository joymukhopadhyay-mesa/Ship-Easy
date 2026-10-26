"use client";
// Visual building blocks modelled on docs/ui-reference: vehicle photos, gauge, two-series bar
// chart, stylised route map, Gantt timeline, truck load grid, health matrix tiles, status colours.
// Presentation only: every number shown is passed in from the engine.
import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";
import { addDays, dayOfWeek, diffDays, prettyDate } from "@/lib/dates";
import { fmtNum, gbp, plural } from "@/lib/format";
import type { BookingResult, CarrierId, RuleResult, Verdict } from "@/lib/types";

// ---------------------------------------------------------------- status colours (one meaning each)
export type Tone = "ok" | "warn" | "bad" | "grey" | "accent";
export const VERDICT_TONE: Record<Verdict, Tone> = { "CLEAR TO SHIP": "ok", "SHIP WITH CARE": "warn", BLOCKED: "bad", INCOMPLETE: "grey" };
export const TONE: Record<Tone, { text: string; bg: string; solid: string; ring: string; hex: string }> = {
  ok: { text: "text-ok", bg: "bg-okSoft", solid: "bg-ok", ring: "ring-ok/30", hex: "#16A34A" },
  warn: { text: "text-warn", bg: "bg-warnSoft", solid: "bg-warnBright", ring: "ring-warnBright/40", hex: "#F59E0B" },
  bad: { text: "text-bad", bg: "bg-badSoft", solid: "bg-bad", ring: "ring-bad/30", hex: "#E5484D" },
  grey: { text: "text-grey", bg: "bg-greySoft", solid: "bg-grey", ring: "ring-grey/30", hex: "#8A8F98" },
  accent: { text: "text-accent", bg: "bg-accentSoft", solid: "bg-accent", ring: "ring-accent/30", hex: "#5B4CF5" },
};
export const VERDICT_LABEL: Record<Verdict, string> = { "CLEAR TO SHIP": "Clear to ship", "SHIP WITH CARE": "Ship with care", BLOCKED: "Blocked", INCOMPLETE: "Incomplete" };
export const VERDICT_MEANING: Record<Verdict, string> = {
  "CLEAR TO SHIP": "Every check passes. Book it.",
  "SHIP WITH CARE": "Can ship, but something should be checked first.",
  BLOCKED: "Must not ship until a red problem is fixed.",
  INCOMPLETE: "Details are missing, so not every check could run.",
};

export const ruleTone = (r: RuleResult): Tone => (r.status === "pass" ? "ok" : r.status === "fail" ? (r.severity === "Red" ? "bad" : "warn") : "grey");

export function Chip({ tone, children, className = "", testId }: { tone: Tone; children: ReactNode; className?: string; testId?: string }) {
  return <span data-testid={testId} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[tone].bg} ${TONE[tone].text} ${className}`}>{children}</span>;
}

export function Dot({ tone, pulse = false, className = "" }: { tone: Tone; pulse?: boolean; className?: string }) {
  return <span className={`relative inline-block h-2.5 w-2.5 shrink-0 rounded-full ${TONE[tone].solid} ${pulse ? "anim-pulse" : ""} ${className}`} style={{ color: TONE[tone].hex }} />;
}

export function StatusPill({ verdict, size = "md" }: { verdict: Verdict; size?: "sm" | "md" | "lg" }) {
  const t = TONE[VERDICT_TONE[verdict]];
  const s = size === "lg" ? "px-4 py-2 text-sm" : size === "sm" ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs";
  return (
    <span data-testid="verdict" className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ${s} ${t.bg} ${t.text}`}>
      <Dot tone={VERDICT_TONE[verdict]} pulse={verdict === "BLOCKED"} />
      <span className="sr-only">{verdict}</span>
      <span aria-hidden>{VERDICT_LABEL[verdict]}</span>
    </span>
  );
}

// ---------------------------------------------------------------- icons (stroke, 24px grid)
const P: Record<string, string> = {
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  chat: "M4 5h16v11H8l-4 4z",
  upload: "M12 16V4m0 0-5 5m5-5 5 5M4 20h16",
  book: "M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4zM5 16a4 4 0 0 1 4-4h10",
  shield: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z",
  barcode: "M4 6v12M7 6v12M10 6v12M14 6v12M17 6v12M20 6v12",
  pound: "M16 6.5A4 4 0 0 0 9 9v9M6 13h8M6 18h12",
  boxes: "M3 9h8v8H3zM13 9h8v8h-8zM8 3h8v6H8z",
  cartons: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  scale: "M12 3v18M5 21h14M6 7h12M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z",
  flame: "M12 3s5 4 5 9a5 5 0 0 1-10 0c0-3 2-4 2-6 2 1 3 3 3 3s0-4 0-6z",
  weight: "M6 8h12l2 12H4zM9 8a3 3 0 0 1 6 0",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M9 15l2 2 4-4",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  truck: "M3 7h11v9H3zM14 10h4l3 3v3h-7z M7 18.5a1.8 1.8 0 1 0 0-.1M17.5 18.5a1.8 1.8 0 1 0 0-.1",
  check: "m5 12 4 4 10-10",
  x: "M6 6l12 12M18 6 6 18",
  alert: "M12 4 2 20h20zM12 10v4M12 17v.5",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5",
  pin: "M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12zM12 11a2 2 0 1 0 0-.1",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  back: "M15 6l-6 6 6 6",
  plus: "M12 5v14M5 12h14",
  doc: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7",
  bolt: "M13 2 4 14h7l-1 8 9-12h-7z",
};
export function Icon({ name, className = "h-5 w-5", strokeWidth = 1.8 }: { name: keyof typeof P | string; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={P[name] ?? P.info} />
    </svg>
  );
}

// ---------------------------------------------------------------- vehicle photos (generated, see scripts/gen-images.mjs)
export const CARRIER_IMG: Record<CarrierId, { src: string; alt: string }> = {
  A: { src: "/img/truck-hero.png", alt: "Articulated truck (Carrier A, road economy)" },
  B: { src: "/img/truck-box.png", alt: "Box truck (Carrier B, road standard)" },
  C: { src: "/img/van.png", alt: "Express van (Carrier C, road express)" },
};
export function VehicleImg({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  // next/image serves a compressed, right-sized WebP/AVIF (the source PNGs are ~1 MB each)
  return <Image src={src} alt={alt} width={1408} height={768} sizes="(max-width: 768px) 90vw, 420px" className={`img-blend select-none object-contain ${className}`} draggable={false} />;
}

// ---------------------------------------------------------------- KPI stat (reference image 1)
export function Stat({ icon, value, label, chip, chipTone = "ok", delay = 0, testId }: { icon: string; value: ReactNode; label: string; chip?: ReactNode; chipTone?: Tone; delay?: number; testId?: string }) {
  return (
    <div data-testid={testId} className="anim-fade-up flex min-w-0 items-center gap-3" style={{ animationDelay: `${delay}ms` }}>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-ink ring-1 ring-line"><Icon name={icon} /></span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[26px] font-semibold leading-none tracking-tight">{value}{chip != null && <Chip tone={chipTone}>{chip}</Chip>}</p>
        <p className="mt-1 truncate text-xs text-muted">{label}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- gauge (reference image 1 "Analytic view")
export function Gauge({ value, max, label, sub, tone = "ok" }: { value: number; max: number; label: string; sub?: string; tone?: Tone }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const r = 80, len = Math.PI * r;
  return (
    <div className="relative mx-auto w-full max-w-[260px]">
      <svg viewBox="0 0 200 112" className="w-full">
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="#E8ECF3" strokeWidth="22" strokeLinecap="round" />
        <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke={tone === "ok" ? "#C9D8EC" : TONE[tone].hex} strokeWidth="22" strokeLinecap="round"
          strokeDasharray={len} className="anim-sweep" style={{ ["--len" as string]: `${len}`, ["--off" as string]: `${len * (1 - pct)}`, strokeDashoffset: len * (1 - pct) } as CSSProperties} />
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <p className="text-[28px] font-semibold leading-none tracking-tight">{label}</p>
        {sub && <p className="mt-1 text-[11px] text-muted">{sub}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- two-series bar chart (reference image 1)
export function WeightChart({ rows, onPick }: { rows: { id: string; label: string; kg: number | null; cap: number | null; tone: Tone }[]; onPick?: (id: string) => void }) {
  const top = Math.max(800, ...rows.map((r) => r.kg ?? 0)) * 1.08;
  const H = 180;
  const y = (v: number) => H - (v / top) * H;
  const lines = [{ v: 400, l: "C 400" }, { v: 500, l: "A 500" }, { v: 750, l: "B 750" }];
  return (
    <div className="flex gap-2">
      <div className="relative w-9 shrink-0 text-right text-[10px] text-muted" style={{ height: H }}>
        {[0, 250, 500, 750].map((v) => <span key={v} className="absolute right-0 -translate-y-1/2" style={{ top: y(v) }}>{v}</span>)}
      </div>
      <div className="relative min-w-0 flex-1 overflow-x-auto">
        <div className="relative" style={{ height: H, minWidth: rows.length * 46 }}>
          {lines.map((g) => (
            <div key={g.v} className="absolute inset-x-0 border-t border-dashed border-zinc-300" style={{ top: y(g.v) }}>
              <span className="absolute -top-2 left-0 z-10 rounded bg-white/90 px-1 text-[9px] font-semibold text-muted">{g.l}</span>
            </div>
          ))}
          <div className="absolute inset-0 flex items-end gap-3 px-1">
            {rows.map((r, k) => (
              <button key={r.id} onClick={() => onPick?.(r.id)} className="group flex h-full min-w-[34px] flex-1 items-end justify-center gap-1" title={`${r.label}: ${r.kg == null ? "unknown" : fmtNum(Math.round(r.kg))} kg per pallet${r.cap ? `, limit ${r.cap} kg` : ""}`}>
                <span className="anim-grow-y w-3 rounded-t-full" style={{ height: r.kg ? Math.max(4, H - y(r.kg)) : 4, background: r.tone === "bad" ? "#E5484D" : "#0B0B0C", animationDelay: `${k * 60}ms` }} />
                <span className="anim-grow-y w-3 rounded-t-full bg-sky" style={{ height: r.cap ? H - y(r.cap) : 4, animationDelay: `${k * 60 + 80}ms` }} />
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3 px-1 pt-1.5" style={{ minWidth: rows.length * 46 }}>
          {rows.map((r) => <span key={r.id} className="min-w-[34px] flex-1 truncate text-center text-[10px] text-muted">{r.label}</span>)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- stylised map UK -> DE/FR/NL (video: route lines on a light map)
const CITY: Record<string, [number, number]> = {
  London: [51.51, -0.13], Manchester: [53.48, -2.24], Birmingham: [52.49, -1.89], Leeds: [53.8, -1.55],
  Berlin: [52.52, 13.4], Frankfurt: [50.11, 8.68], Hamburg: [53.55, 9.99], Paris: [48.86, 2.35], Lyon: [45.76, 4.84], Amsterdam: [52.37, 4.9], Rotterdam: [51.92, 4.48],
};
const prj = ([lat, lon]: [number, number]) => [(lon + 6) * 20, (56 - lat) * 32] as const;
const poly = (pts: [number, number][]) => pts.map((p, i) => `${i ? "L" : "M"}${prj(p)[0].toFixed(1)} ${prj(p)[1].toFixed(1)}`).join(" ") + " Z";
const line = (pts: [number, number][]) => pts.map((p, i) => `${i ? "L" : "M"}${prj(p)[0].toFixed(1)} ${prj(p)[1].toFixed(1)}`).join(" ");
const GB: [number, number][] = [[50.0, -5.7], [50.6, -3.4], [50.7, -1.5], [50.8, 0.3], [51.1, 1.4], [51.5, 1.4], [52.0, 1.6], [52.9, 1.7], [53.1, 0.3], [53.6, 0.1], [54.5, -0.6], [55.0, -1.4], [55.8, -2.0], [56.0, -2.6], [56.0, -5.6], [55.6, -4.9], [54.9, -5.0], [54.8, -3.3], [54.1, -3.2], [53.4, -3.0], [53.3, -4.6], [52.8, -4.6], [52.1, -4.7], [51.7, -5.2], [51.6, -4.0], [51.4, -3.2], [51.2, -4.2], [50.6, -4.8]];
const CONT: [number, number][] = [[44.0, -1.3], [44.6, -1.25], [45.6, -1.2], [46.5, -1.8], [47.3, -2.5], [47.8, -4.3], [48.5, -4.8], [48.8, -3.0], [48.6, -1.6], [49.7, -1.9], [49.3, -1.2], [49.4, -0.3], [49.7, 0.2], [50.1, 1.6], [51.0, 2.5], [51.3, 3.3], [51.6, 3.6], [51.9, 4.0], [52.5, 4.6], [53.0, 4.7], [53.4, 5.5], [53.4, 7.0], [53.6, 8.2], [54.0, 8.8], [54.5, 8.6], [55.5, 8.1], [56.0, 8.2], [56.0, 10.5], [55.0, 10.6], [54.8, 9.9], [54.4, 11.0], [54.1, 12.1], [54.6, 13.4], [53.9, 14.2], [53.9, 15.0], [44.0, 15.0]];
const SWE: [number, number][] = [[56.0, 12.6], [55.4, 12.9], [55.4, 14.2], [56.0, 14.7]];
const BORDERS: [number, number][][] = [
  [[51.0, 2.5], [50.1, 4.8], [49.5, 6.4], [49.0, 8.2], [48.6, 7.8], [47.5, 7.5], [46.4, 6.2], [45.9, 6.9], [44.2, 7.6]],
  [[51.4, 3.4], [51.4, 4.5], [51.2, 5.8], [50.8, 6.0]],
  [[53.3, 7.2], [52.3, 7.0], [51.8, 6.0], [51.2, 6.1], [50.8, 6.0], [50.1, 6.1], [49.5, 6.4]],
  [[47.5, 7.5], [47.7, 9.5], [47.5, 10.5], [47.6, 13.0], [48.6, 13.8], [49.0, 13.4], [50.3, 12.1], [50.9, 14.8], [51.0, 15.0]],
  [[54.8, 8.6], [54.8, 9.9]],
];
export interface MapRoute { id: string; from: string | null; to: string | null; tone: Tone; active?: boolean }
export function RouteMap({ routes, height = 260, legend = true }: { routes: MapRoute[]; height?: number; legend?: boolean }) {
  const valid = routes.filter((r) => r.from && r.to && CITY[r.from] && CITY[r.to]);
  const cities = new Set(valid.flatMap((r) => [r.from!, r.to!]));
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#EEF0F3]" style={{ height }}>
      <svg viewBox="40 40 380 300" preserveAspectRatio="xMidYMid meet" className="h-full w-full" overflow="visible">
        <defs>
          <pattern id="mapgrid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#E3E6EA" strokeWidth="0.6" /></pattern>
        </defs>
        <rect x="-800" y="-400" width="2000" height="1200" fill="url(#mapgrid)" />
        {[GB, CONT, SWE].map((p, k) => <path key={k} d={poly(p)} fill="#FFFFFF" stroke="#D5D9DF" strokeWidth="1" />)}
        {BORDERS.map((b, k) => <path key={k} d={line(b)} fill="none" stroke="#D5D9DF" strokeWidth="0.9" strokeDasharray="3 3" />)}
        {[["UNITED KINGDOM", 52.9, -3.6], ["FRANCE", 46.9, 1.0], ["GERMANY", 51.2, 9.8], ["NETH.", 52.95, 6.0], ["BELGIUM", 50.55, 3.9]].map(([t, la, lo]) => {
          const [x, yy] = prj([la as number, lo as number]);
          return <text key={t as string} x={x} y={yy} fontSize="7.5" letterSpacing="1.5" fill="#A6ACB5" fontWeight="600" fontFamily="Inter, sans-serif">{t}</text>;
        })}
        {valid.map((r, k) => {
          const [x1, y1] = prj(CITY[r.from!]);
          const [x2, y2] = prj(CITY[r.to!]);
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
          const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy) || 1;
          const cx = mx - (dy / d) * d * 0.18, cy = my + (dx / d) * d * 0.18;
          const col = r.tone === "ok" ? "#0B0B0C" : TONE[r.tone].hex;
          return (
            <g key={`${r.id}-${k}`} opacity={valid.some((v) => v.active) && !r.active ? 0.35 : 1}>
              <path d={`M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}`} fill="none" stroke={col} strokeWidth={r.active ? 3 : 2} strokeLinecap="round" className={r.tone === "accent" || r.active ? "anim-dash" : ""} />
            </g>
          );
        })}
        {[...cities].map((c) => {
          const [x, yy] = prj(CITY[c]);
          const isDest = !["London", "Manchester", "Birmingham", "Leeds"].includes(c);
          return (
            <g key={c}>
              <circle cx={x} cy={yy} r={isDest ? 5.5 : 4.5} fill={isDest ? "#FFFFFF" : "#0B0B0C"} stroke="#0B0B0C" strokeWidth="2" />
              <text x={x + 7} y={yy + 3} fontSize="9" fontWeight="600" fill="#0B0B0C" fontFamily="Inter, sans-serif">{c}</text>
            </g>
          );
        })}
      </svg>
      {legend && (
        <div className="absolute bottom-2 left-2 flex flex-wrap gap-2 rounded-full bg-white/95 px-3 py-1.5 text-[10px] font-medium shadow-card">
          <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-ink" /> Clear</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-warnBright" /> With care</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-bad" /> Blocked</span>
          <span className="flex items-center gap-1"><span className="h-0.5 w-4 bg-grey" /> Incomplete</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Gantt (reference image 2 + video "Driver timeline")
export function CarrierGantt({ res, today }: { res: BookingResult; today: string }) {
  const c = res.carrier;
  const col = c.dates.collection;
  if (!col || !c.options.length) return <p className="text-xs text-muted">The timeline appears once the ready date and destination are known.</p>;
  const etas = c.options.map((o) => o.eta!).filter(Boolean);
  const start = addDays(col, -1);
  const end = addDays(etas.sort().at(-1) ?? addDays(col, 5), 1);
  const days = diffDays(start, end) + 1;
  const pos = (d: string) => (diffDays(start, d) / days) * 100;
  const todayIn = today >= start && today <= end;
  return (
    <div className="relative">
      <div className="ml-24 grid text-[10px] text-muted" style={{ gridTemplateColumns: `repeat(${days}, minmax(0,1fr))` }}>
        {Array.from({ length: days }, (_, k) => {
          const d = addDays(start, k);
          const we = dayOfWeek(d) === 0 || dayOfWeek(d) === 6;
          return <div key={d} className={`border-l border-line py-1 text-center ${we ? "bg-zinc-50" : ""}`}>{prettyDate(d).split(" ").slice(0, 2).join(" ")}</div>;
        })}
      </div>
      <div className="space-y-2 pt-2">
        {c.options.map((o, k) => {
          const chosen = o.id === c.chosen;
          const left = pos(col), width = Math.max(4, pos(addDays(o.eta!, 1)) - pos(col));
          const style = !o.feasible && c.kgPerPallet != null ? "bg-badSoft text-bad ring-1 ring-bad/40" : chosen ? "bg-gradient-to-r from-accent to-[#8B7BFF] text-white shadow-[0_4px_14px_rgba(91,76,245,.35)]" : "bg-zinc-200 text-zinc-600";
          return (
            <div key={o.id} className="flex items-center">
              <div className="w-24 shrink-0 pr-2 text-xs font-semibold">{o.name}<span className="block text-[10px] font-normal text-muted">{o.service.replace("Road ", "")}</span></div>
              <div className="relative h-8 flex-1 rounded-lg bg-[#F7F8FA]">
                <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days}, minmax(0,1fr))` }}>{Array.from({ length: days }, (_, d) => <span key={d} className="border-l border-white" />)}</div>
                <div className={`anim-grow-x absolute top-1 flex h-6 items-center justify-between overflow-hidden rounded-md px-2 text-[10px] font-semibold ${style}`} style={{ left: `${left}%`, width: `${width}%`, animationDelay: `${k * 120}ms` }}>
                  <span className="truncate">{!o.feasible && c.kgPerPallet != null ? "Too heavy" : `${gbp(o.totalCost)} · ${o.transitDays}d`}</span>
                  <span className="truncate pl-1">{prettyDate(o.eta).slice(0, 10)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {todayIn && (
        <div className="pointer-events-none absolute bottom-0 top-0 ml-24" style={{ left: 0, right: 0 }}>
          <div className="absolute bottom-0 top-0 w-px bg-bad" style={{ left: `${pos(today) + 100 / days / 2}%` }}>
            <span className="absolute -top-1 left-1/2 -translate-x-1/2 rounded-full bg-bad px-1.5 text-[9px] font-semibold text-white">Today</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- truck load grid (reference image 2)
export function TruckLoad({ res }: { res: BookingResult }) {
  const b = res.booking;
  const c = res.carrier;
  const n = b.pallets && b.pallets > 0 ? Math.min(b.pallets, 33) : 0;
  const per = c.kgPerPallet;
  const chosen = c.options.find((o) => o.id === c.chosen) ?? null;
  const cap = chosen?.maxKgPerPallet ?? null;
  const over = per != null && (cap == null ? c.r05 === "no_carrier_fits" : per > cap);
  const near = per != null && cap != null && !over && per > cap * 0.9;
  const tone: Tone = per == null ? "grey" : over ? "bad" : near ? "warn" : "ok";
  const scaleMax = Math.max(800, (per ?? 0) * 1.1);
  const caps = c.options.map((o) => ({ id: o.id, cap: o.maxKgPerPallet })).sort((a, b) => a.cap - b.cap);
  return (
    <div>
      <div className="flex items-end gap-2">
        <div className="relative flex-1 rounded-xl border-2 border-zinc-300 bg-[#F7F8FA] p-2">
          {n === 0 ? (
            <p className="py-6 text-center text-xs text-muted">Pallets not given yet</p>
          ) : (
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${n <= 6 ? n : Math.ceil(n / 2)}, minmax(0,1fr))` }}>
              {Array.from({ length: n }, (_, k) => (
                <div key={k} className={`anim-fade-up flex min-h-[46px] flex-col items-center justify-center rounded-md border text-center ${TONE[tone].bg} ${tone === "bad" ? "border-bad/50" : tone === "warn" ? "border-warnBright/50" : tone === "ok" ? "border-ok/40" : "border-zinc-300"}`} style={{ animationDelay: `${k * 40}ms` }}>
                  <span className="text-[9px] font-semibold text-muted">P{k + 1}</span>
                  <span className={`text-[11px] font-semibold ${TONE[tone].text}`}>{per == null ? "?" : `${fmtNum(Math.round(per))} kg`}</span>
                </div>
              ))}
            </div>
          )}
          {b.pallets && b.pallets > 33 ? <p className="mt-1 text-center text-[10px] text-muted">+{b.pallets - 33} more pallets</p> : null}
        </div>
        <svg viewBox="0 0 60 70" className="h-[70px] w-[60px] shrink-0" aria-hidden>
          <path d="M4 14h30l14 18v26H4z" fill="#FFFFFF" stroke="#0B0B0C" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M36 18h6l10 14H36z" fill="#C9D8EC" />
          <circle cx="16" cy="60" r="7" fill="#0B0B0C" /><circle cx="40" cy="60" r="7" fill="#0B0B0C" />
        </svg>
      </div>
      <div className="mt-4">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold">Weight per pallet {per == null ? "—" : `${fmtNum(Math.round(per))} kg`}</span>
          <span className={TONE[tone].text}>{per == null ? "Needs pallets & gross weight" : cap == null ? "Above every carrier's limit" : `${Math.round((per / cap) * 100)}% of ${chosen!.name}'s ${cap} kg limit`}</span>
        </div>
        <div className="relative mt-2 h-3 rounded-full bg-zinc-100">
          {per != null && <div className={`anim-grow-x absolute inset-y-0 left-0 rounded-full ${TONE[tone].solid}`} style={{ width: `${Math.min(100, (per / scaleMax) * 100)}%` }} />}
          {caps.map((x) => (
            <div key={x.id} className="absolute -top-1 bottom-[-4px] w-0.5 bg-ink/70" style={{ left: `${(x.cap / scaleMax) * 100}%` }}>
              <span className="absolute top-4 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold text-muted">{x.id} {x.cap}</span>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[10px] text-muted">Black ticks are each carrier's maximum kg per pallet (limit is inclusive). The bar is this shipment.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- health matrix: the 10 checks at a glance
const RULE_TILE: Record<string, { name: string; icon: string }> = {
  "R-01": { name: "HS code", icon: "barcode" }, "R-02": { name: "Declared value", icon: "pound" }, "R-03": { name: "Carton maths", icon: "cartons" },
  "R-04": { name: "Carton count", icon: "boxes" }, "R-05": { name: "Pallet weight", icon: "scale" }, "R-06": { name: "Dangerous goods", icon: "flame" },
  "R-07": { name: "Gross weight", icon: "weight" }, "R-08": { name: "Delivery slot", icon: "calendar" }, "R-09": { name: "Made in", icon: "globe" }, "R-10": { name: "Ready date", icon: "clock" },
};
export const ruleName = (id: string) => RULE_TILE[id]?.name ?? id;

function tileValue(r: RuleResult, res: BookingResult): string {
  const b = res.booking;
  const c = res.carrier;
  const sumCartons = b.items.reduce((s, i) => s + (i.cartons ?? 0), 0);
  const goods = b.items.reduce((s, i) => s + (i.quantity ?? 0) * (i.unitWeight ?? 0), 0);
  const sum = b.items.reduce((s, i) => s + (i.quantity ?? 0) * (i.unitPrice ?? 0), 0);
  if (r.status === "not_checked" || r.status === "cannot_compute") return "Waiting for details";
  switch (r.id) {
    case "R-02": return `${gbp(b.declaredValue)} vs ${gbp(sum)}`;
    case "R-04": return `${fmtNum(b.cartons)} vs ${plural(sumCartons, "carton")}`;
    case "R-05": { const o = c.options.find((x) => x.id === c.chosen); return c.kgPerPallet == null ? "—" : `${fmtNum(Math.round(c.kgPerPallet))} / ${o ? o.maxKgPerPallet : 750} kg`; }
    case "R-07": return `${fmtNum(b.grossWeight)} vs ${fmtNum(Math.round(goods))} kg goods`;
    case "R-08": return b.destinationType !== "Warehouse" ? "Not a warehouse" : b.appointmentBooked ? "Booked" : "Not booked";
    case "R-10": return prettyDate(b.readyDate);
    case "R-06": return r.status === "pass" ? "None found" : r.state === "explicit" ? "Restricted item" : "Needs your OK";
    case "R-01": return r.status === "pass" ? `${b.items.length} item${b.items.length === 1 ? "" : "s"} coded` : "Code missing/short";
    case "R-09": return r.status === "pass" ? "All items" : "Missing";
    case "R-03": return r.status === "pass" ? "Adds up" : "Doesn't add up";
    default: return "";
  }
}
const STATUS_WORD = (r: RuleResult) => (r.status === "pass" ? "OK" : r.status === "fail" ? (r.severity === "Red" ? "Must fix" : "Check") : r.status === "cannot_compute" ? "Can't tell yet" : "Not checked");

export function HealthMatrix({ res, onPick }: { res: BookingResult; onPick?: (id: string) => void }) {
  return (
    <div data-testid="health-matrix" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {res.rules.map((r, k) => {
        const t = ruleTone(r);
        const tile = RULE_TILE[r.id];
        return (
          <button key={r.id} data-testid={`tile-${r.id}`} onClick={() => onPick?.(r.id)} title={r.text}
            className={`anim-fade-up group relative flex min-w-0 flex-col rounded-2xl p-3 text-left ring-1 transition hover:-translate-y-0.5 hover:shadow-lift ${TONE[t].bg} ${TONE[t].ring}`} style={{ animationDelay: `${k * 35}ms` }}>
            <div className="flex items-center justify-between">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full bg-white ${TONE[t].text}`}><Icon name={tile.icon} className="h-4 w-4" /></span>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-white ${TONE[t].solid}`}><Icon name={t === "ok" ? "check" : t === "grey" ? "clock" : t === "warn" ? "alert" : "x"} className="h-3 w-3" strokeWidth={2.6} /></span>
            </div>
            <p className="mt-2 text-[13px] font-semibold leading-tight">{tile.name}</p>
            <p className={`text-[11px] font-semibold ${TONE[t].text}`}>{STATUS_WORD(r)} <span className="font-normal text-muted">· {r.id}</span></p>
            <p className="mt-0.5 truncate text-[11px] text-muted">{tileValue(r, res)}</p>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- route progress line (video hero card)
export function RouteTrack({ res }: { res: BookingResult }) {
  const b = res.booking;
  const c = res.carrier;
  const t = VERDICT_TONE[res.verdict];
  const stops = [
    { label: b.originCity ?? "UK collection city", sub: b.readyDate ? `Ready ${prettyDate(b.readyDate).slice(0, 10)}` : "Ready date?" },
    { label: "Collection", sub: c.dates.collection ? prettyDate(c.dates.collection).slice(0, 10) : "—" },
    { label: "Channel crossing", sub: "Day 1" },
    { label: b.destinationCity ?? "Destination", sub: c.dates.eta ? `ETA ${prettyDate(c.dates.eta).slice(0, 10)}` : "ETA —" },
  ];
  const problem = res.rules.find((r) => r.status === "fail" && r.severity === "Red") ?? res.rules.find((r) => r.status === "fail");
  return (
    <div className="relative px-2 pt-8">
      <div className="absolute left-6 right-6 top-[46px] h-[3px] rounded-full bg-zinc-200" />
      <div className={`anim-grow-x absolute left-6 top-[46px] h-[3px] rounded-full ${t === "ok" ? "bg-ink" : TONE[t].solid}`} style={{ width: t === "ok" ? "calc(100% - 3rem)" : "34%" }} />
      {t === "ok" && <svg className="absolute left-6 right-6 top-[22px] h-6 w-[calc(100%-3rem)] overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 10"><path d="M2 10 Q50 -8 98 10" fill="none" stroke="#5B4CF5" strokeWidth="0.6" className="anim-dash" vectorEffect="non-scaling-stroke" /></svg>}
      {problem && (
        <span className={`absolute left-[16%] top-0 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE[ruleTone(problem)].bg} ${TONE[ruleTone(problem)].text}`}>
          {problem.severity === "Red" ? "Stopped here" : "Check"}: {ruleName(problem.id)} ({problem.id})
        </span>
      )}
      <div className="relative grid grid-cols-4">
        {stops.map((s, k) => (
          <div key={k} className={`flex flex-col ${k === 0 ? "items-start" : k === 3 ? "items-end text-right" : "items-center text-center"}`}>
            {k === 0 ? (
              <span className="anim-drive relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-ink text-white ring-4 ring-white"><Icon name="truck" className="h-4 w-4" /></span>
            ) : (
              <span className={`relative z-10 mt-2.5 h-3 w-3 rounded-full ring-4 ring-white ${k === 3 ? "border-2 border-ink bg-white" : "bg-ink"}`} />
            )}
            <p className="mt-2 text-xs font-semibold">{s.label}</p>
            <p className={`text-[11px] ${k === 3 && c.dates.eta && t === "ok" ? "text-ok" : "text-muted"}`}>{s.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({ compact = false }: { compact?: boolean }) {
  const items: Verdict[] = ["CLEAR TO SHIP", "SHIP WITH CARE", "BLOCKED", "INCOMPLETE"];
  return (
    <div data-testid="legend" className={`flex flex-wrap gap-2 ${compact ? "" : "gap-3"}`}>
      {items.map((v) => (
        <span key={v} className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs ${TONE[VERDICT_TONE[v]].bg}`}>
          <Dot tone={VERDICT_TONE[v]} />
          <b className={TONE[VERDICT_TONE[v]].text}>{VERDICT_LABEL[v]}</b>
          {!compact && <span className="text-muted">{VERDICT_MEANING[v]}</span>}
        </span>
      ))}
    </div>
  );
}

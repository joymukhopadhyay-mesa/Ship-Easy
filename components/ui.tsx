"use client";
// Small presentational primitives styled after docs/ui-reference (white rounded cards,
// black active pills, soft status colours).
import type { ReactNode } from "react";
import type { Confidence, Verdict } from "@/lib/types";

export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <section id={id} className={`rounded-card bg-white shadow-card ${className}`}>{children}</section>;
}

export function CardHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5">
      <div>
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

const VERDICT_STYLE: Record<Verdict, string> = {
  BLOCKED: "bg-bad text-white",
  "SHIP WITH CARE": "bg-warn text-white",
  "CLEAR TO SHIP": "bg-ok text-white",
  INCOMPLETE: "bg-zinc-500 text-white",
};

export function VerdictBadge({ verdict, size = "md" }: { verdict: Verdict; size?: "sm" | "md" | "lg" }) {
  const s = size === "lg" ? "px-4 py-1.5 text-sm" : size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs";
  return <span data-testid="verdict" className={`inline-flex items-center whitespace-nowrap rounded-full font-semibold tracking-wide ${s} ${VERDICT_STYLE[verdict]}`}>{verdict}</span>;
}

export function SeverityChip({ severity, status }: { severity: "Red" | "Amber"; status: string }) {
  if (status === "pass") return <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-ok">Pass</span>;
  if (status !== "fail") return <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">{status === "cannot_compute" ? "Cannot compute" : "Not checked"}</span>;
  return severity === "Red"
    ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-bad">Red</span>
    : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-warn">Amber</span>;
}

export function ConfidenceChip({ c }: { c: Confidence }) {
  const st = c === "High" ? "bg-green-50 text-ok" : c === "Possible" ? "bg-amber-50 text-warn" : "bg-violet-50 text-accent";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st}`}>Confidence: {c}</span>;
}

export function Pill({ active, children, onClick, testId }: { active?: boolean; children: ReactNode; onClick?: () => void; testId?: string }) {
  return (
    <button data-testid={testId} onClick={onClick} className={`rounded-full px-4 py-2 text-sm font-medium transition ${active ? "bg-ink text-white" : "text-ink hover:bg-zinc-100"}`}>
      {children}
    </button>
  );
}

export function Btn({ children, onClick, disabled, variant = "dark", title, testId, className = "" }: { children: ReactNode; onClick?: () => void; disabled?: boolean; variant?: "dark" | "light" | "ghost"; title?: string; testId?: string; className?: string }) {
  const st = variant === "dark" ? "bg-ink text-white hover:bg-zinc-800" : variant === "light" ? "bg-white text-ink ring-1 ring-line hover:bg-zinc-50" : "text-ink hover:bg-zinc-100";
  return (
    <button data-testid={testId} title={title} onClick={onClick} disabled={disabled} className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${st} ${className}`}>
      {children}
    </button>
  );
}

export function Toggle({ on, onChange, label, testId }: { on: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-ink">
      <button data-testid={testId} role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative h-5 w-9 rounded-full transition ${on ? "bg-ink" : "bg-zinc-300"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${on ? "left-[18px]" : "left-0.5"}`} />
      </button>
      {label}
    </label>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-card bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="rounded-full p-1.5 hover:bg-zinc-100">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const TruckIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17.5" cy="17.5" r="1.8" /></svg>
);
export const BoxIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" /><path d="M3 7.5 12 12l9-4.5M12 12v9" /></svg>
);
export const ScaleIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><path d="M12 3v18M5 21h14M6 7h12M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z" /></svg>
);
export const ClockIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);
export const CheckIcon = ({ className = "h-5 w-5" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}><path d="m5 12 4 4 10-10" /></svg>
);

/** Simple truck illustration for the carrier card (no external assets). */
export function TruckArt() {
  return (
    <svg viewBox="0 0 220 110" className="h-24 w-auto" aria-hidden>
      <rect x="8" y="22" width="132" height="62" rx="6" fill="#F4F5F7" stroke="#D4D7DD" />
      <path d="M140 40h40l22 22v22h-62z" fill="#FFFFFF" stroke="#D4D7DD" />
      <path d="M150 46h26l14 14h-40z" fill="#C9D8EC" />
      <rect x="8" y="78" width="194" height="8" rx="3" fill="#0B0B0C" />
      <circle cx="44" cy="90" r="11" fill="#0B0B0C" /><circle cx="44" cy="90" r="4" fill="#9CA3AF" />
      <circle cx="170" cy="90" r="11" fill="#0B0B0C" /><circle cx="170" cy="90" r="4" fill="#9CA3AF" />
      <text x="20" y="58" fontSize="16" fontWeight="700" fill="#0B0B0C" fontFamily="Inter, sans-serif">PreFlight</text>
    </svg>
  );
}

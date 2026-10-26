"use client";
// AI-suggested HS code for an item that has none (or an invalid one). Always "Possible",
// always with an official description and a link to the UK Trade Tariff, and the code can
// only be used AFTER the seller has opened that link (the verification loop).
import { formatHs, tariffSearchUrl, type HsSuggestion } from "@/lib/hs";
import type { Item } from "@/lib/types";
import { Btn, ConfidenceChip } from "./ui";
import { Icon } from "./visuals";

export interface HsUi {
  byRow: Record<string, HsSuggestion | undefined>;
  loading: Record<string, boolean>;
  opened: Record<string, boolean>;
  localOnly: boolean;
  onOpen: (rowId: string) => void;
  onUse: (rowId: string, code: string) => void;
}

export function HsSuggestBlock({ item, hs }: { item: Item; hs: HsUi }) {
  const s = hs.byRow[item.rowId];
  const loading = hs.loading[item.rowId];
  const opened = hs.opened[item.rowId];
  const label = `${item.sku}${item.description ? ` (${item.description})` : ""}`;
  return (
    <div data-testid={`hs-${item.rowId}`} className="mt-2 rounded-xl bg-accentSoft p-3 ring-1 ring-accent/20">
      <p className="text-xs font-semibold text-ink">HS code for {label}</p>
      {loading && !s ? (
        <p className="mt-1 text-xs text-muted"><span className="anim-shimmer mr-2 inline-block h-3 w-16 rounded-full align-middle" />Looking up a likely code…</p>
      ) : s?.code ? (
        <>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span data-testid="hs-code" className="rounded-lg bg-white px-2.5 py-1 font-mono text-sm font-semibold ring-1 ring-line">{formatHs(s.code)}</span>
            <ConfidenceChip c="Possible" />
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${opened ? "bg-okSoft text-ok" : "bg-warnSoft text-warn"}`}>{opened ? "Link opened — now confirm" : "Not verified"}</span>
          </div>
          {s.official && <p className="mt-1.5 text-xs text-ink"><b>Official tariff says:</b> {s.official}</p>}
          <p className="mt-1 text-[11px] text-muted">An AI guess from the description, checked only to confirm the code exists. It can't know if it's right for your product. Only you can confirm that.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <a data-testid="hs-verify" href={s.url} target="_blank" rel="noopener noreferrer" onClick={() => hs.onOpen(item.rowId)}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800">
              <Icon name="globe" className="h-3.5 w-3.5" /> Verify on gov.uk Trade Tariff ↗
            </a>
            <Btn testId="hs-use" variant="light" disabled={!opened} onClick={() => hs.onUse(item.rowId, s.code!)}
              title={opened ? "Use this code" : "Open the tariff link first and check the code"}>
              I checked it — use {formatHs(s.code)}
            </Btn>
          </div>
          {!opened && <p className="mt-1.5 text-[11px] text-warn">The button unlocks after you open the tariff link. Or type your own code in the item row below.</p>}
        </>
      ) : (
        <div className="mt-1 text-xs text-muted">
          <p>{hs.localOnly ? "Local-only mode makes no AI suggestions." : s?.note ?? "No suggestion available."} Find the code yourself, then type it in the item row below.</p>
          <a href={s?.url ?? tariffSearchUrl} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink ring-1 ring-line hover:bg-zinc-50">
            <Icon name="globe" className="h-3.5 w-3.5" /> Search the Trade Tariff ↗
          </a>
        </div>
      )}
    </div>
  );
}

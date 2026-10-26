"use client";
import { Modal } from "./ui";

export interface SentRecord {
  at: string;
  route: "chat" | "explain" | "hazard" | "hs";
  model: string | null;
  payload: string;
  outcome: string;
}

export const PRIVACY_STATEMENT =
  "Validation runs entirely in your browser. No file is uploaded or stored. Only item descriptions and the computed findings are sent to the model, for the hazard check and the written explanation.";

export function AssumptionsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const items = [
    "Timezone is Europe/London for every date. R-10 fails only for dates before today; today itself passes.",
    "Transit times are calendar days. Collection = ready date if Monday–Friday, otherwise the next Monday. ETA = collection + transit, rolled to the next Monday if it lands on a weekend. UK bank holidays are out of scope.",
    "R-02's 1% tolerance is measured against the computed sum of quantity × unit price.",
    "Balanced weights are cost 40 / transit 30 / reliability 30 (adjustable on the carrier panel), min-max normalised over the carriers that can take the load.",
    "The rate card and the rulebook are the fixed template Sheets 3 and 4. Only those 10 rules can produce a Red or Amber; anything else is shown as \"FYI, not a rule\".",
    "R-05's \"chosen carrier\" is the recommended one unless the seller picks another. The weight cap is inclusive.",
    "Field trust: unit price, units per carton, unit weight and all route/date/priority/type fields are trusted and never auto-corrected. Only pallets, cartons, declared value, gross weight, HS code, quantity and item cartons can be proposed for correction.",
    "Gross weight fixes are never High confidence: the goods weight is only a floor, because packaging weight is unknowable.",
    "Verdict precedence: any Red → Blocked; otherwise any missing data → Incomplete; otherwise any Amber → Ship with care; otherwise Clear to ship.",
    "R-06: an implied hazard (e.g. wireless earbuds) stays Red until the seller declares it safe. The declaration is logged with date and time; there is no login, so no identity is claimed.",
    "Chat: origin is always the UK and currency always GBP; destination country comes from the city; cartons and declared value are calculated from the items and shown for confirmation.",
  ];
  return (
    <Modal open={open} onClose={onClose} title="Assumptions">
      <ul data-testid="assumptions" className="list-disc space-y-2 pl-5 text-sm">{items.map((t) => <li key={t}>{t}</li>)}</ul>
    </Modal>
  );
}

export function PrivacyPanel({ open, onClose, sent, localOnly }: { open: boolean; onClose: () => void; sent: SentRecord[]; localOnly: boolean }) {
  return (
    <Modal open={open} onClose={onClose} title="Privacy and what was sent">
      <p data-testid="privacy-statement" className="text-sm">{PRIVACY_STATEMENT}</p>
      <p className="mt-2 text-sm text-muted">When an HS code is missing, the item description goes to the AI for a suggestion, and only the suggested 6-digit code (never your descriptions or any booking data) is sent to the UK government's public Trade Tariff to confirm it exists. Suggestions are never applied until you've opened the tariff link and confirmed.</p>
      <p className="mt-2 text-sm text-muted">In chat, your message text is sent so the model can read the fields you mention; it never receives the booking itself. Local-only mode {localOnly ? "is ON: nothing is sent to any model." : "is OFF. Turn it on to send nothing at all."}</p>
      <h3 className="mt-4 text-sm font-semibold">Show what was sent</h3>
      {sent.length === 0 ? (
        <p data-testid="sent-empty" className="mt-1 text-sm text-muted">Nothing has been sent to a model in this session.</p>
      ) : (
        <ol data-testid="sent-list" className="mt-2 space-y-2">
          {[...sent].reverse().map((s, k) => (
            <li key={k} className="rounded-xl bg-[#F4F5F7] p-3 text-xs">
              <p className="font-semibold">{s.at} · /api/{s.route} · {s.model ?? "no model"} · {s.outcome}</p>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{s.payload}</pre>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

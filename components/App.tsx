"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatEdit, chatTurn, extractContext, newChat, type ChatState } from "@/lib/chat";
import { DEFAULT_WEIGHTS } from "@/lib/config";
import { londonStamp, prettyDate } from "@/lib/dates";
import { correctedWorkbook } from "@/lib/exportXlsx";
import { uploadNarrative } from "@/lib/explain";
import { extractLocal } from "@/lib/localExtract";
import { parseWorkbook, type OrphanRow } from "@/lib/parse";
import { emptyPatch, type Patch } from "@/lib/patch";
import { reportHtml } from "@/lib/report";
import { applyEdits, newSession, type Edit, type Session } from "@/lib/session";
import type { Env, Weights } from "@/lib/types";
import { reconcile, validateBooking, type Reconciliation } from "@/lib/validate";
import { BookingCard } from "./BookingCard";
import { AssumptionsPanel, PrivacyPanel, type SentRecord } from "./Panels";
import { Btn, Card, CardHeader, Pill, Toggle, TruckIcon, VerdictBadge } from "./ui";

type Msg = { role: "user" | "bot"; text: string; at: string };

const EXAMPLES: { label: string; text: string; testId: string }[] = [
  { label: "Demo 1 · 1,600 kg on 2 pallets", testId: "ex-demo1", text: "Ship 600 cast iron skillets from Birmingham to our warehouse in Hamburg, ready 02-11-2026. £18 each, 6 per carton, 2.3 kg each, HS 732393, made in China. 1,600 kg on 2 pallets. Balanced please, delivery appointment is booked." },
  { label: "Demo 2 · Fastest, 3 pallets", testId: "ex-demo2", text: "Ship 1,200 wooden chopping boards from Leeds to a warehouse in Frankfurt, ready 02-11-2026. £9 each, 10 per carton, 0.95 kg each, HS 441990, made in Vietnam. Total weight 1,260 kg on 3 pallets. Fastest please, appointment is booked." },
  { label: "Casual, details missing", testId: "ex-casual", text: "Need to send 600 cast iron skillets to Hamburg" },
  { label: "1,000 mugs at 12 per carton", testId: "ex-nondiv", text: "I'm sending 1,000 ceramic mugs from London to a warehouse in Berlin, 12 per carton, £5 each" },
  { label: "Wireless earbuds", testId: "ex-hazard", text: "Shipping 200 wireless earbuds to a shop in Paris, £20 each, 25 per carton" },
];

const download = (data: BlobPart, name: string, type: string) => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function App({ today }: { today: string }) {
  const [tab, setTab] = useState<"chat" | "upload">("chat");
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const env: Env = useMemo(() => ({ today, weights }), [today, weights]);
  const [localOnly, setLocalOnly] = useState(true);
  const [banner, setBanner] = useState<string | null>(null);
  const [sent, setSent] = useState<SentRecord[]>([]);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  // ---- chat
  const [chat, setChat] = useState<ChatState>(() => newChat({ today }));
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "bot", at: "", text: "Hi! Tell me what you're shipping, in your own words — for example \"600 cast iron skillets to a warehouse in Hamburg\". I'll ask only for what's missing, check it against the rulebook and recommend a carrier." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // scroll only the chat log, never the page (the change log must stay above the fold)
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  // ---- upload
  const [fileName, setFileName] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [orphans, setOrphans] = useState<OrphanRow[]>([]);
  const [recon, setRecon] = useState<Reconciliation | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // weights change -> re-validate everything (no log entry: it's a setting, not a booking edit)
  useEffect(() => {
    setChat((c) => ({ ...c, session: { ...c.session, result: validateBooking(c.session.booking, env) } }));
    setSessions((ss) => ss.map((s) => ({ ...s, result: validateBooking(s.booking, env) })));
  }, [env]);

  const stamp = () => londonStamp(new Date());

  const getPatch = useCallback(async (message: string, st: ChatState): Promise<Patch> => {
    const ctx = extractContext(st, today);
    if (localOnly) return extractLocal(message, ctx);
    return extractLocal(message, ctx);
  }, [localOnly, today]);

  const send = async (text: string, base?: ChatState) => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: message, at: stamp() }]);
    try {
      const st = base ?? chat;
      const patch = await getPatch(message, st);
      const t = chatTurn(st, patch ?? emptyPatch(), message, env, stamp());
      setChat(t.state);
      setMsgs((m) => [...m, { role: "bot", text: t.reply, at: stamp() }]);
    } catch {
      setMsgs((m) => [...m, { role: "bot", text: "Sorry, I couldn't process that. Please try rephrasing.", at: stamp() }]);
    } finally {
      setBusy(false);
    }
  };

  const resetChat = (intro = "Started over. What are you shipping?") => {
    const fresh = newChat(env);
    setChat(fresh);
    setMsgs([{ role: "bot", at: "", text: intro }]);
    return fresh;
  };

  const loadWorkbook = async (buf: ArrayBuffer, name: string) => {
    setUploadError(null);
    try {
      const parsed = parseWorkbook(buf);
      const ss = parsed.bookings.map((b) => newSession("file", b, env));
      setSessions(ss);
      setOrphans(parsed.orphans);
      setRecon(reconcile(parsed, ss.map((s) => s.result)));
      setNotes(parsed.notes);
      setSelected(0);
      setFileName(name);
    } catch {
      setUploadError("That file couldn't be read. Please upload the Bookings and Items sheets as an .xlsx file.");
    }
  };
  const onFile = async (f: File | undefined | null) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) return setUploadError("That file is larger than 10 MB. Please upload just the Bookings and Items sheets.");
    loadWorkbook(await f.arrayBuffer(), f.name);
  };
  const loadSample = async () => {
    try {
      const r = await fetch("/sample-bookings.xlsx");
      loadWorkbook(await r.arrayBuffer(), "sample-bookings.xlsx");
    } catch {
      setUploadError("The sample file couldn't be loaded. Please try again.");
    }
  };

  // ---- edits from the card
  const editChat = (edits: Edit[], source: "apply" | "edit" | "action" | "declaration") => setChat((c) => chatEdit(c, edits, source, env, stamp()));
  const editUpload = (edits: Edit[], source: "apply" | "edit" | "action" | "declaration") =>
    setSessions((ss) => ss.map((s, k) => (k === selected ? applyEdits(s, edits, source, env, stamp()).session : s)));

  const cardFor = (mode: "chat" | "upload") => {
    const s = mode === "chat" ? chat.session : sessions[selected];
    if (!s) return null;
    const onEdits = mode === "chat" ? editChat : editUpload;
    const allResults = mode === "chat" ? [chat.session.result] : sessions.map((x) => x.result);
    const allLogs = mode === "chat" ? [chat.session.log] : sessions.map((x) => x.log);
    return (
      <BookingCard
        result={s.result}
        log={s.log}
        env={env}
        weights={weights}
        onWeights={setWeights}
        onEdits={onEdits}
        showAddPallet
        onConfirmHazard={(rowId) => onEdits([{ path: "item.hazardConfirmedAt", rowId, value: stamp() }], "declaration")}
        onDownloadXlsx={() => download(correctedWorkbook(allResults), mode === "chat" ? "preflight-booking.xlsx" : `corrected-${fileName ?? "bookings.xlsx"}`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        onDownloadReport={() => download(reportHtml({ title: "PreFlight pre-flight report", today, results: allResults, logs: allLogs, reconciliation: mode === "upload" ? recon?.line : undefined, orphans: mode === "upload" ? orphans : undefined }), "preflight-report.html", "text/html")}
      />
    );
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-16 pt-4 md:px-6">
      {/* top bar, after the reference's pill navigation */}
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-white px-4 py-3 shadow-card">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-white"><TruckIcon className="h-5 w-5" /></span>
          <div><p className="text-sm font-semibold leading-tight">PreFlight</p><p className="text-[10px] text-muted">Shipment booking & pre-flight checker</p></div>
        </div>
        <nav className="flex rounded-full bg-[#F4F5F7] p-1">
          <Pill testId="tab-chat" active={tab === "chat"} onClick={() => setTab("chat")}>Chat booking</Pill>
          <Pill testId="tab-upload" active={tab === "upload"} onClick={() => setTab("upload")}>Upload sheets</Pill>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <Toggle testId="local-only" on={localOnly} onChange={(v) => { setLocalOnly(v); setBanner(null); }} label="Local-only mode" />
          <Btn variant="light" onClick={() => setShowAssumptions(true)} testId="open-assumptions">Assumptions</Btn>
          <Btn variant="light" onClick={() => setShowPrivacy(true)} testId="open-privacy">Privacy</Btn>
        </div>
      </header>

      {banner && <div data-testid="fallback-banner" className="mt-3 rounded-2xl bg-amber-50 px-4 py-2.5 text-sm text-warn ring-1 ring-amber-200">{banner}</div>}

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Pre-flight check</h1>
          <p className="mt-1 text-sm text-muted">UK → Germany · France · Netherlands. Describe a shipment or upload your sheets; every booking gets a verdict, the fixes and a carrier.</p>
        </div>
        <div className="rounded-full bg-white px-4 py-2 text-xs shadow-card"><span className="text-muted">Today</span> <b data-testid="today">{prettyDate(today)}</b> <span className="text-muted">· Europe/London</span></div>
      </div>

      {tab === "chat" ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(340px,420px)_1fr]">
          <Card className="flex h-fit min-w-0 flex-col lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
            <CardHeader title="Describe your shipment" subtitle={localOnly ? "Local-only: understood by on-device rules, no AI" : "Gemini reads your words into fields; code does every number"} right={<Btn variant="ghost" onClick={() => resetChat()} testId="chat-reset">Start over</Btn>} />
            <div ref={logRef} data-testid="chat-log" className="mt-3 max-h-[60vh] min-h-[220px] flex-1 space-y-3 overflow-y-auto px-5 lg:max-h-none">
              {msgs.map((m, k) => (
                <div key={k} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${m.role === "user" ? "bg-ink text-white" : "bg-[#F4F5F7] text-ink"}`} data-testid={m.role === "bot" ? "bot-msg" : "user-msg"}>{m.text}</div>
                </div>
              ))}
              {busy && <div className="text-xs text-muted">Thinking…</div>}
            </div>
            <div className="border-t border-line p-4">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {EXAMPLES.map((e) => <button key={e.label} data-testid={e.testId} onClick={() => send(e.text, resetChat(`Example: ${e.label}`))} className="rounded-full bg-[#F4F5F7] px-2.5 py-1 text-[11px] font-medium hover:bg-zinc-200">{e.label}</button>)}
                {chat.baselined && <button data-testid="chip-add-pallet" onClick={() => send("add another pallet")} className="rounded-full bg-ink px-2.5 py-1 text-[11px] font-semibold text-white">+ add another pallet</button>}
              </div>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
                <input data-testid="chat-input" value={input} onChange={(e) => setInput(e.target.value.slice(0, 1000))} placeholder="e.g. 1,000 mugs to Berlin, £5 each…" className="min-w-0 flex-1 rounded-full border border-line bg-white px-4 py-2 text-sm outline-none focus:border-ink" />
                <Btn testId="chat-send" disabled={busy || !input.trim()}>Send</Btn>
              </form>
            </div>
          </Card>
          <div className="min-w-0">{cardFor("chat")}</div>
        </div>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(320px,400px)_1fr]">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader title="Upload Bookings & Items" subtitle="Template structure (header row 2, example row 3). Parsed in your browser — nothing is uploaded." />
              <div className="p-5">
                <label
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files?.[0]); }}
                  className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${dragging ? "border-ink bg-zinc-50" : "border-zinc-300"}`}>
                  <span className="text-sm font-semibold">Drop your .xlsx here</span>
                  <span className="mt-1 text-xs text-muted">or click to choose a file</span>
                  <input data-testid="file-input" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn testId="load-sample" onClick={loadSample}>Load sample file</Btn>
                  <a href="/template.xlsx" download className="inline-flex items-center rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold ring-1 ring-line hover:bg-zinc-50">Download blank template</a>
                </div>
                {uploadError && <p className="mt-3 text-sm text-bad">{uploadError}</p>}
              </div>
            </Card>
            {recon && (
              <Card>
                <CardHeader title={fileName ?? "Bookings"} subtitle={uploadNarrative(sessions.map((s) => s.result))} />
                <p data-testid="reconciliation" className="mx-5 mt-3 rounded-xl bg-[#F4F5F7] px-3 py-2 font-mono text-xs font-semibold">{recon.line}</p>
                {notes.map((n, k) => <p key={k} className="mx-5 mt-2 text-xs text-warn">{n}</p>)}
                <ul data-testid="booking-list" className="mt-3 max-h-[480px] overflow-y-auto pb-3">
                  {sessions.map((s, k) => {
                    const r = s.result;
                    const red = r.rules.filter((x) => x.status === "fail" && x.severity === "Red").map((x) => x.id);
                    const amb = r.rules.filter((x) => x.status === "fail" && x.severity === "Amber").map((x) => x.id);
                    return (
                      <li key={`${s.booking.bookingId}-${s.booking.row}`}>
                        <button data-testid={`booking-${s.booking.bookingId}`} onClick={() => setSelected(k)} className={`flex w-full items-center justify-between gap-2 px-5 py-2.5 text-left hover:bg-zinc-50 ${k === selected ? "bg-zinc-100" : ""}`}>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">{s.booking.bookingId}{s.booking.duplicateOf ? " (duplicate ID)" : ""} <span className="font-normal text-muted">· {s.booking.destinationCity ?? "?"}</span></p>
                            <p className="truncate text-[11px] text-muted">{[...red.map((x) => `${x} Red`), ...amb.map((x) => `${x} Amber`), ...r.gate.map((g) => g.code)].join(" · ") || "no findings"}{s.log.length ? ` · ${s.log.length} edit(s)` : ""}</p>
                          </div>
                          <VerdictBadge verdict={r.verdict} size="sm" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {orphans.length > 0 && (
                  <div data-testid="unmatched" className="border-t border-line px-5 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Unmatched item rows (D-03)</p>
                    {orphans.map((o) => <p key={o.row} className="mt-1 text-xs">Row {o.row}: Booking ID <b>{o.bookingId}</b> ({o.sku} {o.description}) has no matching booking.</p>)}
                  </div>
                )}
              </Card>
            )}
          </div>
          <div className="min-w-0">
            {sessions.length ? cardFor("upload") : (
              <Card className="p-10 text-center">
                <p className="text-lg font-semibold">No file yet</p>
                <p className="mt-1 text-sm text-muted">Upload your Bookings and Items sheets, or press <b>Load sample file</b> to see a multi-booking check with planted mistakes.</p>
              </Card>
            )}
          </div>
        </div>
      )}

      <AssumptionsPanel open={showAssumptions} onClose={() => setShowAssumptions(false)} />
      <PrivacyPanel open={showPrivacy} onClose={() => setShowPrivacy(false)} sent={sent} localOnly={localOnly} />
      <footer className="mt-10 text-center text-[11px] text-muted">Rules and rates are the fixed template Sheets 3 and 4. Every number is computed by tested code; AI only reads your words and writes explanations.</footer>
    </div>
  );
}

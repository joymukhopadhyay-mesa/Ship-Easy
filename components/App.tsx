"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatEdit, chatTurn, extractContext, newChat, type ChatState } from "@/lib/chat";
import { DEFAULT_WEIGHTS } from "@/lib/config";
import { londonStamp, prettyDate } from "@/lib/dates";
import { correctedWorkbook } from "@/lib/exportXlsx";
import { carrierReason, fixText, uploadNarrative } from "@/lib/explain";
import { classifyHazard } from "@/lib/hazards";
import { extractLocal } from "@/lib/localExtract";
import { parseWorkbook, type OrphanRow } from "@/lib/parse";
import { emptyPatch, PatchSchema, type Patch } from "@/lib/patch";
import type { ExplainInput } from "@/lib/modelContract";
import { reportHtml } from "@/lib/report";
import { applyEdits, newSession, revalidate, type Edit, type Session } from "@/lib/session";
import type { BookingResult, Env, HazardKind, Item, Weights } from "@/lib/types";
import { reconcile, validateBooking, type Reconciliation } from "@/lib/validate";
import { BookingCard } from "./BookingCard";
import { AssumptionsPanel, PrivacyPanel, type SentRecord } from "./Panels";
import { Btn, Card, CardHeader, Pill, Toggle, TruckIcon } from "./ui";
import { Overview, type Row } from "./Overview";
import { Chip, Dot, Icon, Legend, StatusPill, VehicleImg, VERDICT_TONE } from "./visuals";

type Msg = { id?: number; role: "user" | "bot"; text: string; at: string; queued?: boolean };

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

/** Identifies the exact booking state a narrative was written for. */
function narrativeKey(scope: string, r: BookingResult): string {
  const fails = r.rules.filter((x) => x.status !== "pass").map((x) => `${x.id}:${x.status}:${x.state ?? ""}`).join(",");
  const str = JSON.stringify([r.booking, r.verdict, fails, r.carrier.chosen, r.carrier.weights]);
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `${scope}#${r.booking.bookingId}#${h >>> 0}`;
}

export default function App({ today }: { today: string }) {
  const [tab, setTab] = useState<"overview" | "chat" | "upload">("overview");
  const [openFile, setOpenFile] = useState(false);
  const [showHelp, setShowHelp] = useState(true);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [hazardHints, setHazardHints] = useState<Record<string, HazardKind>>({});
  const env: Env = useMemo(() => ({ today, weights, hazardHints }), [today, weights, hazardHints]);
  const [localOnly, setLocalOnlyState] = useState(false);
  const localOnlyRef = useRef(false);
  const setLocalOnly = (v: boolean) => { localOnlyRef.current = v; setLocalOnlyState(v); };
  // AI narratives are keyed by the exact booking state they describe, so a stale one can never show.
  const [narratives, setNarratives] = useState<Record<string, string>>({});
  const inFlight = useRef(new Set<string>());
  const [chatRun, setChatRun] = useState(1);
  const hintsRef = useRef<Record<string, HazardKind>>({});
  const hazardChecked = useRef(new Set<string>());
  const implicated = useRef(new Set<string>());
  const [banner, setBanner] = useState<string | null>(null);
  const [sent, setSent] = useState<SentRecord[]>([]);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);

  // ---- chat
  const [chat, setChat] = useState<ChatState>(() => newChat({ today }));
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "bot", at: "", text: "Hi! Tell me what you're shipping, in your own words — for example \"600 cast iron skillets to a warehouse in Hamburg\". I'll ask only for what's missing, check it against the rulebook and recommend a carrier." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Messages typed while a reply is being worked out are queued (never dropped) and run in order,
  // each against the booking as it is after the previous one.
  const chatRef = useRef(chat);
  useEffect(() => { chatRef.current = chat; }, [chat]);
  const busyRef = useRef(false);
  const queueRef = useRef<{ id: number; text: string }[]>([]);
  const runIdRef = useRef(0);
  const msgId = useRef(1);
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
  const [uploadScope, setUploadScope] = useState("file");

  // weights change -> re-validate everything (no log entry: it's a setting, not a booking edit)
  useEffect(() => {
    setChat((c) => ({ ...c, session: revalidate(c.session, env) }));
    setSessions((ss) => ss.map((s) => revalidate(s, env)));
  }, [env]);

  const stamp = () => londonStamp(new Date());

  // ---- model calls (server routes hold the key). Any failure -> Local-only + banner, never an error.
  const FALLBACK_TEXT = "The AI service is unavailable, so Ship Easy switched to Local-only mode. Everything still works.";
  const fallBack = (message: string) => {
    setLocalOnly(true);
    setBanner(message);
  };
  const postModel = async <T,>(route: "chat" | "hazard" | "explain", body: unknown): Promise<(T & { ok: true; model?: string; costUsd?: number | null }) | null> => {
    const at = stamp();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`/api/${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
      const j = await res.json().catch(() => null);
      setSent((x) => [...x, { at, route, model: j?.model ?? null, payload: JSON.stringify(body, null, 2), outcome: j?.ok ? `ok${typeof j.costUsd === "number" ? ` · ${j.costUsd.toFixed(5)}` : ""}` : `fell back to Local-only (${j?.reason ?? "error"})` }]);
      if (!j?.ok) { fallBack(typeof j?.message === "string" ? j.message : FALLBACK_TEXT); return null; }
      return j;
    } catch {
      setSent((x) => [...x, { at, route, model: null, payload: JSON.stringify(body, null, 2), outcome: "fell back to Local-only (timeout or network)" }]);
      fallBack(FALLBACK_TEXT);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const getPatch = useCallback(async (message: string, st: ChatState): Promise<Patch> => {
    const ctx = extractContext(st, today);
    if (localOnlyRef.current) return extractLocal(message, ctx);
    const j = await postModel<{ patch: unknown }>("chat", { message, today, context: ctx });
    const p = j ? PatchSchema.safeParse(j.patch) : null;
    if (p?.success) return p.data;
    if (j) fallBack(FALLBACK_TEXT);
    return extractLocal(message, ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  /** R-06: only descriptions the local list does NOT already flag are sent; hints can only ADD "implied". */
  const checkHazards = async (items: Item[]): Promise<Record<string, HazardKind>> => {
    if (localOnlyRef.current) return {};
    const uniq = [...new Set(items.filter((i) => i.description && classifyHazard(i.description).kind === "none" && !hazardChecked.current.has(i.description)).map((i) => i.description))];
    const flaggedBefore = new Set(Object.keys(hintsRef.current));
    const known: Record<string, HazardKind> = {};
    for (const it of items) if (!flaggedBefore.has(it.rowId) && implicated.current.has(it.description)) known[it.rowId] = "implied";
    if (!uniq.length) { if (Object.keys(known).length) { hintsRef.current = { ...hintsRef.current, ...known }; setHazardHints(hintsRef.current); } return known; }
    uniq.forEach((d) => hazardChecked.current.add(d));
    const j = await postModel<{ results: { index: number; kind: string }[] }>("hazard", { descriptions: uniq });
    if (!j) return known;
    j.results.filter((r) => r.kind !== "none").forEach((r) => uniq[r.index] && implicated.current.add(uniq[r.index]));
    const hints: Record<string, HazardKind> = { ...known };
    for (const it of items) if (implicated.current.has(it.description) && !flaggedBefore.has(it.rowId)) hints[it.rowId] = "implied";
    if (Object.keys(hints).length) { hintsRef.current = { ...hintsRef.current, ...hints }; setHazardHints(hintsRef.current); }
    return hints;
  };

  const explainInput = (r: BookingResult): ExplainInput => ({
    ref: r.booking.bookingId,
    verdict: r.verdict,
    items: r.booking.items.map((i) => i.description).filter(Boolean).slice(0, 30),
    findings: r.rules.filter((x) => x.status === "fail").map((x) => {
      const reps = r.repairs.filter((p) => p.rules.includes(x.id));
      const fix = reps.length ? reps.map((p) => `${p.message} (confidence ${p.confidence})`).join(" ") : fixText(x, r);
      return { rule: x.id, severity: x.severity, problem: x.message.slice(0, 400), fix: fix.slice(0, 500) };
    }).slice(0, 12),
    carrier: carrierReason(r.carrier).reason.slice(0, 400),
  });
  /** ONE batched call per upload; one call per changed booking afterwards. Stored under each booking's exact state. */
  const explain = async (scope: string, results: BookingResult[]) => {
    if (localOnlyRef.current || !results.length) return;
    const keys = results.map((r) => narrativeKey(scope, r));
    const todo = results.filter((_, k) => !inFlight.current.has(keys[k]));
    if (!todo.length) return;
    keys.forEach((k) => inFlight.current.add(k));
    try {
      const j = await postModel<{ narratives: { ref: string; text: string }[] }>("explain", { bookings: todo.slice(0, 60).map(explainInput) });
      if (!j) return;
      const map: Record<string, string> = {};
      for (const n of j.narratives) {
        const k = results.findIndex((r) => r.booking.bookingId === n.ref);
        if (k >= 0) map[keys[k]] = n.text;
      }
      setNarratives((x) => ({ ...x, ...map }));
    } finally {
      keys.forEach((k) => inFlight.current.delete(k));
    }
  };

  /** One turn. Returns the new state, or null if the chat was reset while it was running. */
  const runTurn = async (message: string, st: ChatState, run: number): Promise<ChatState | null> => {
    const at = stamp();
    try {
      const patch = (await getPatch(message, st)) ?? emptyPatch();
      let t = chatTurn(st, patch, message, { ...env, hazardHints: hintsRef.current }, at);
      const newHints = await checkHazards(t.state.session.booking.items);
      if (Object.keys(newHints).length) t = chatTurn(st, patch, message, { ...env, hazardHints: hintsRef.current }, at);
      if (run !== runIdRef.current) return null;
      chatRef.current = t.state;
      setChat(t.state);
      setMsgs((m) => [...m, { role: "bot", text: t.reply, at: stamp() }]);
      return t.state;
    } catch {
      if (run !== runIdRef.current) return null;
      setMsgs((m) => [...m, { role: "bot", text: "Sorry, I couldn't process that. Please try rephrasing.", at: stamp() }]);
      return st;
    }
  };

  const send = async (text: string, base?: ChatState) => {
    const message = text.trim();
    if (!message) return;
    setInput("");
    const id = msgId.current++;
    if (busyRef.current && !base) {
      // still thinking: show it now, run it next
      queueRef.current.push({ id, text: message });
      setMsgs((m) => [...m, { id, role: "user", text: message, at: stamp(), queued: true }]);
      return;
    }
    setMsgs((m) => [...m, { id, role: "user", text: message, at: stamp() }]);
    busyRef.current = true;
    setBusy(true);
    const run = runIdRef.current;
    let st = base ?? chatRef.current;
    let next: { id: number; text: string } | undefined = { id, text: message };
    try {
      while (next) {
        const cur: { id: number; text: string } = next;
        setMsgs((m) => m.map((x) => (x.id === cur.id ? { ...x, queued: false } : x)));
        const out = await runTurn(cur.text, st, run);
        if (out === null) return; // reset meanwhile: drop the rest
        st = out;
        next = queueRef.current.shift();
      }
    } finally {
      if (run === runIdRef.current) { busyRef.current = false; setBusy(false); }
    }
  };

  const dropHints = (prefix: string) => {
    hintsRef.current = Object.fromEntries(Object.entries(hintsRef.current).filter(([k]) => !k.startsWith(prefix)));
    setHazardHints(hintsRef.current);
  };

  const resetChat = (intro = "Started over. What are you shipping?") => {
    const fresh = newChat(env);
    runIdRef.current += 1; // any turn still running for the old chat is discarded
    queueRef.current = [];
    busyRef.current = false;
    setBusy(false);
    chatRef.current = fresh;
    setChatRun((n) => n + 1); // a new run never reuses an earlier run's explanation
    dropHints("c"); // chat row ids restart at c1, so the previous run's hazard flags must not carry over
    setChat(fresh);
    setMsgs([{ role: "bot", at: "", text: intro }]);
    return fresh;
  };

  const loadWorkbook = async (buf: ArrayBuffer, name: string) => {
    setUploadError(null);
    try {
      const parsed = parseWorkbook(buf);
      dropHints("i");
      const ss = parsed.bookings.map((b) => newSession("file", b, env));
      setSessions(ss);
      setOrphans(parsed.orphans);
      setRecon(reconcile(parsed, ss.map((s) => s.result)));
      setNotes(parsed.notes);
      setSelected(0);
      setOpenFile(false);
      setTab("overview");
      setFileName(name);
      const scope = `file:${name}:${Date.now()}`;
      setUploadScope(scope);
      void checkHazards(parsed.bookings.flatMap((b) => b.items)).then(() => {
        const envNow = { ...env, hazardHints: hintsRef.current };
        return explain(scope, ss.map((x) => revalidate(x, envNow).result));
      });
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

  const chatScope = `chat:${chatRun}`;
  const chatReady = chat.session.capture === null && !chat.pending && chat.baselined;
  const shown = tab === "chat" ? (chatReady ? { scope: chatScope, result: chat.session.result } : null) : tab === "overview" && openFile && sessions[selected] ? { scope: uploadScope, result: sessions[selected].result } : null;
  const shownKey = shown ? narrativeKey(shown.scope, shown.result) : null;
  useEffect(() => {
    if (!shown || !shownKey || localOnly || narratives[shownKey]) return;
    const id = setTimeout(() => void explain(shown.scope, [shown.result]), 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey, localOnly]);

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
        mode={mode === "chat" ? "chat" : "file"}
        narrative={localOnly ? null : mode === "chat" && !chatReady ? null : (narratives[narrativeKey(mode === "chat" ? chatScope : uploadScope, s.result)] ?? "Updating the explanation for the latest version of this booking…")}
        onConfirmHazard={(rowId) => onEdits([{ path: "item.hazardConfirmedAt", rowId, value: stamp() }], "declaration")}
        onDownloadXlsx={() => download(correctedWorkbook(allResults), mode === "chat" ? "ship-easy-booking.xlsx" : `corrected-${fileName ?? "bookings.xlsx"}`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        onDownloadReport={() => download(reportHtml({ title: "Ship Easy pre-flight report", today, results: allResults, logs: allLogs, reconciliation: mode === "upload" ? recon?.line : undefined, orphans: mode === "upload" ? orphans : undefined }), "ship-easy-report.html", "text/html")}
      />
    );
  };

  const greeting = (() => {
    const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date()));
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();
  const rows: Row[] = [
    ...(chat.session.booking.items.length || chat.session.booking.destinationCity ? [{ key: "chat", source: "chat" as const, result: chat.session.result, edits: chat.session.log.length }] : []),
    ...sessions.map((s, k) => ({ key: `file-${k}`, source: "file" as const, result: s.result, edits: s.log.length })),
  ];
  const openRow = (key: string) => {
    if (key === "chat") { setTab("chat"); return; }
    setSelected(Number(key.replace("file-", "")));
    setOpenFile(true);
    setTab("overview");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const NAV: { id: typeof tab; label: string; icon: string; badge?: number }[] = [
    { id: "overview", label: "Overview", icon: "grid", badge: rows.filter((r) => r.result.verdict === "BLOCKED").length || undefined },
    { id: "chat", label: "Book by chat", icon: "chat" },
    { id: "upload", label: "Upload sheets", icon: "upload" },
  ];
  const go = (id: typeof tab) => { setTab(id); if (id === "overview") setOpenFile(false); };

  return (
    <div className="min-h-screen md:pl-[84px]">
      {/* slim icon sidebar (reference video) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[84px] flex-col items-center gap-2 border-r border-line bg-white py-5 md:flex">
        <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-ink text-white"><TruckIcon className="h-5 w-5" /></span>
        {NAV.map((n) => (
          <button key={n.id} data-testid={`nav-${n.id}`} onClick={() => go(n.id)} title={n.label} className={`group relative flex w-16 flex-col items-center gap-1 rounded-2xl py-2.5 text-[10px] font-medium transition ${tab === n.id ? "bg-ink text-white" : "text-muted hover:bg-[#F4F5F7] hover:text-ink"}`}>
            <Icon name={n.icon} />
            <span className="leading-tight">{n.label.split(" ")[0]}</span>
            {n.badge ? <span className="absolute right-2 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[9px] font-bold text-white">{n.badge}</span> : null}
          </button>
        ))}
        <div className="mt-auto flex flex-col items-center gap-2">
          <button onClick={() => setShowAssumptions(true)} title="Assumptions" className="flex w-16 flex-col items-center gap-1 rounded-2xl py-2 text-[10px] text-muted hover:bg-[#F4F5F7]"><Icon name="book" />Rules</button>
          <button onClick={() => setShowPrivacy(true)} title="Privacy" className="flex w-16 flex-col items-center gap-1 rounded-2xl py-2 text-[10px] text-muted hover:bg-[#F4F5F7]"><Icon name="shield" />Privacy</button>
        </div>
      </aside>

      <div className="mx-auto max-w-[1440px] px-4 pb-16 pt-4 md:px-7">
        {/* header: greeting + nav pills (mobile) + controls (reference images 1 & video) */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-ink text-white md:hidden"><TruckIcon className="h-5 w-5" /></span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Ship Easy · UK → Germany · France · Netherlands</p>
              <h1 className="text-3xl font-light tracking-tight md:text-[40px]">{greeting}<span className="text-muted">.</span> <span className="font-semibold">{tab === "overview" ? (openFile ? "Shipment check" : "Your shipments") : tab === "chat" ? "Book by chat" : "Upload sheets"}</span></h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs shadow-card"><Icon name="calendar" className="h-4 w-4 text-muted" /><span className="text-muted">Today</span> <b data-testid="today">{prettyDate(today)}</b></div>
            <div className="rounded-full bg-white px-3 py-2 shadow-card"><Toggle testId="local-only" on={localOnly} onChange={(v) => { setLocalOnly(v); setBanner(null); }} label={localOnly ? "Local-only (no AI)" : "AI on"} /></div>
            <button data-testid="new-booking" onClick={() => { resetChat(); setTab("chat"); }} className="flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-white shadow-[0_6px_16px_rgba(91,76,245,.35)] hover:opacity-90"><Icon name="plus" className="h-4 w-4" /> New booking</button>
          </div>
        </header>
        <nav className="mt-3 flex w-fit rounded-full bg-white p-1 shadow-card md:hidden">
          {NAV.map((n) => <Pill key={n.id} testId={`tab-${n.id}`} active={tab === n.id} onClick={() => go(n.id)}>{n.label}</Pill>)}
        </nav>
        <div className="hidden"><button data-testid="tab-chat" onClick={() => go("chat")} /><button data-testid="tab-upload" onClick={() => go("upload")} /><button data-testid="open-assumptions" onClick={() => setShowAssumptions(true)} /><button data-testid="open-privacy" onClick={() => setShowPrivacy(true)} /></div>

        {banner && <div data-testid="fallback-banner" className="mt-3 flex items-center gap-2 rounded-2xl bg-warnSoft px-4 py-2.5 text-sm text-warn ring-1 ring-warnBright/30"><Icon name="alert" className="h-4 w-4" />{banner}</div>}

        {showHelp && (
          <div className="anim-fade-up mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-3 shadow-card">
            <div className="flex flex-wrap items-center gap-3"><span className="flex items-center gap-1.5 text-xs font-semibold"><Icon name="info" className="h-4 w-4 text-accent" /> How to read the colours</span><Legend compact /></div>
            <button className="text-xs text-muted hover:text-ink" onClick={() => setShowHelp(false)}>Got it</button>
          </div>
        )}

        <div className="mt-5">
          {tab === "overview" && (openFile && sessions[selected] ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <button data-testid="back-overview" onClick={() => setOpenFile(false)} className="flex items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-semibold shadow-card hover:bg-zinc-50"><Icon name="back" className="h-4 w-4" /> All shipments</button>
                <div className="flex gap-1 overflow-x-auto">
                  {sessions.map((s, k) => (
                    <button key={k} data-testid={`booking-tab-${s.booking.bookingId}`} onClick={() => setSelected(k)} className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${k === selected ? "bg-white shadow-card ring-2 ring-accent" : "bg-white/60 hover:bg-white"}`}>
                      <Dot tone={VERDICT_TONE[s.result.verdict]} />{s.booking.bookingId}
                    </button>
                  ))}
                </div>
              </div>
              {cardFor("upload")}
            </div>
          ) : (
            <Overview rows={rows} onOpen={openRow} onSample={() => void loadSample()} onChatDemo={() => { setTab("chat"); send(EXAMPLES[0].text, resetChat(`Example: ${EXAMPLES[0].label}`)); }} onUpload={() => setTab("upload")} reconciliation={recon?.line ?? null} />
          ))}

          {tab === "chat" && (
            <div className="grid gap-5 lg:grid-cols-[minmax(340px,410px)_1fr]">
              <Card className="flex h-fit min-w-0 flex-col lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
                <div className="flex items-start justify-between gap-3 px-5 pt-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accentSoft text-accent"><Icon name="spark" /></span>
                    <div><h3 className="text-[15px] font-semibold">Booking assistant</h3><p className="text-xs text-muted">{localOnly ? "Local-only: on-device rules, no AI" : "AI reads your words · code does every number"}</p></div>
                  </div>
                  <Btn variant="ghost" onClick={() => resetChat()} testId="chat-reset">Start over</Btn>
                </div>
                <div ref={logRef} data-testid="chat-log" className="mt-3 max-h-[60vh] min-h-[220px] flex-1 space-y-3 overflow-y-auto px-5 lg:max-h-none">
                  {msgs.map((m, k) => (
                    <div key={k} className={`anim-fade-up flex ${m.role === "user" ? "justify-end" : "justify-start gap-2"}`}>
                      {m.role === "bot" && <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accentSoft text-accent"><Icon name="spark" className="h-3.5 w-3.5" /></span>}
                      <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${m.role === "user" ? "rounded-br-md bg-ink text-white" : "rounded-tl-md bg-[#F4F5F7] text-ink"}`} data-testid={m.role === "bot" ? "bot-msg" : "user-msg"}>{m.text}{m.queued && <span data-testid="queued" className="mt-1 block text-[10px] font-semibold text-white/70">Queued — I'll read this next</span>}</div>
                    </div>
                  ))}
                  {busy && <div className="flex items-center gap-2 text-xs text-muted"><span className="anim-shimmer h-6 w-24 rounded-full" /> Checking…</div>}
                </div>
                <div className="border-t border-line p-4">
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {chat.session.log.length === 0 && EXAMPLES.map((e) => <button key={e.label} data-testid={e.testId} onClick={() => send(e.text, resetChat(`Example: ${e.label}`))} className="rounded-full bg-[#F4F5F7] px-2.5 py-1 text-[11px] font-medium hover:bg-accentSoft hover:text-accent">{e.label}</button>)}
                    {chat.baselined && <button data-testid="chip-add-pallet" onClick={() => send("add another pallet")} className="rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-white">+ add another pallet</button>}
                  </div>
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
                    <input data-testid="chat-input" value={input} onChange={(e) => setInput(e.target.value.slice(0, 1000))} placeholder={busy ? "Still checking… you can keep typing" : "e.g. 1,000 mugs to Berlin, £5 each…"} className="min-w-0 flex-1 rounded-full border border-line bg-white px-4 py-2 text-sm outline-none focus:border-accent" />
                    <Btn testId="chat-send" disabled={!input.trim()}>{busy ? "Queue" : "Send"}</Btn>
                  </form>
                </div>
              </Card>
              <div className="min-w-0">{cardFor("chat")}</div>
            </div>
          )}

          {tab === "upload" && (
            <div className="grid gap-5 lg:grid-cols-[minmax(320px,420px)_1fr]">
              <Card>
                <div className="p-5">
                  <h3 className="text-[15px] font-semibold">Upload Bookings & Items</h3>
                  <p className="text-xs text-muted">Template structure (header row 2, example row 3). Read in your browser — nothing is uploaded.</p>
                  <label
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files?.[0]); }}
                    className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-10 text-center transition ${dragging ? "border-accent bg-accentSoft" : "border-zinc-300 hover:border-accent"}`}>
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accentSoft text-accent"><Icon name="upload" /></span>
                    <span className="mt-3 text-sm font-semibold">Drop your .xlsx here</span>
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
              <Card>
                {recon ? (
                  <>
                    <CardHeader title={fileName ?? "Bookings"} subtitle={uploadNarrative(sessions.map((s) => s.result))} right={<Btn onClick={() => go("overview")}>Open dashboard</Btn>} />
                    <p data-testid="reconciliation" className="mx-5 mt-3 inline-flex rounded-full bg-[#F4F5F7] px-3 py-1 font-mono text-xs font-semibold">{recon.line}</p>
                    {notes.map((n, k) => <p key={k} className="mx-5 mt-2 text-xs text-warn">{n}</p>)}
                    <ul data-testid="booking-list" className="mt-3 max-h-[520px] overflow-y-auto pb-3">
                      {sessions.map((s, k) => {
                        const r = s.result;
                        return (
                          <li key={`${s.booking.bookingId}-${s.booking.row}`}>
                            <button data-testid={`booking-${s.booking.bookingId}`} onClick={() => openRow(`file-${k}`)} className="flex w-full items-center justify-between gap-2 px-5 py-2.5 text-left hover:bg-zinc-50">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold">{s.booking.bookingId}{s.booking.duplicateOf ? " (duplicate ID)" : ""} <span className="font-normal text-muted">· {s.booking.originCity ?? "?"} → {s.booking.destinationCity ?? "?"}</span></p>
                                <div className="mt-1 flex flex-wrap gap-1">{r.rules.filter((x) => x.status === "fail").map((x) => <Chip key={x.id} tone={x.severity === "Red" ? "bad" : "warn"}>{x.id}</Chip>)}{r.gate.map((g, j) => <Chip key={j} tone="grey">{g.code}</Chip>)}</div>
                              </div>
                              <StatusPill verdict={r.verdict} size="sm" />
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
                  </>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center p-10 text-center">
                    <VehicleImg src="/img/van.png" alt="Van" className="h-32 w-full max-w-xs" />
                    <p className="mt-2 text-lg font-semibold">No file yet</p>
                    <p className="mt-1 max-w-sm text-sm text-muted">Upload your Bookings and Items sheets, or press <b>Load sample file</b> to see a multi-booking check with planted mistakes.</p>
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>

        <AssumptionsPanel open={showAssumptions} onClose={() => setShowAssumptions(false)} />
        <PrivacyPanel open={showPrivacy} onClose={() => setShowPrivacy(false)} sent={sent} localOnly={localOnly} />
        <footer className="mt-10 text-center text-[11px] text-muted">Rules and rates are the fixed template Sheets 3 and 4. Every number is computed by tested code; AI only reads your words and writes explanations. <button className="underline" onClick={() => setShowAssumptions(true)}>Assumptions</button> · <button className="underline" onClick={() => setShowPrivacy(true)}>Privacy</button></footer>
      </div>
    </div>
  );
}

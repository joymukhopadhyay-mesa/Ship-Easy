# Ship Easy

Conversational shipment booking + pre-flight error checker for UK → Germany / France / Netherlands.
A seller describes a shipment in plain language, or uploads the Bookings and Items sheets, and gets one **Booking Card** per booking:
a verdict (Blocked / Ship with care / Clear to ship / Incomplete), every finding with the rule ID, severity, the numbers and a fix with a
confidence label, a carrier recommendation for their priority with the reasoning, a plain-English confirmation, next steps, and downloads.

> **Stage 1 submission deadline:** not stated in the case files — check the submission form. The MVP link must stay live until
> **Wednesday 28 October 2026, end of day IST**.

**Design principle — deterministic truth, AI voice.** Every number, rule result, repair and ranking comes from pure, tested TypeScript in `/lib`.
Gemini (Google models via OpenRouter) only (a) reads the seller's message into a small field patch, (b) flags implied hazardous goods for R-06,
and (c) writes explanations. With no key, or on any model error, the app switches to **Local-only mode** and still works fully.

## Run locally

```bash
npm install
```
```bash
npm run dev
```
Open http://localhost:3000. Without `.env.local` the app runs in Local-only mode.

To enable the AI layer, create `.env.local` (git-ignored) from `.env.example`:
```
OPENROUTER_API_KEY=...            # server-side only
GEMINI_MODEL=google/gemini-3.7-flash
GEMINI_FALLBACK_MODEL=google/gemini-3.5-flash-lite
```

## Tests

```bash
npm test
```
- 142 tests: all 22 template-structure fixtures vs `fixtures/expected.json`, rule edge cases, the "no suggestion may fail a rule" invariant
  (400 perturbed bookings), parser layouts (header moved, reordered columns, corrupt rows, 50 bookings < 2 s), chat scripts, exports, model client.
- `npm run oracle` — independent recomputation of `expected.json` from the raw fixture workbooks (imports nothing from `/lib`).
- `node scripts/live-model-check.mjs` — optional real-model checks against a running dev server (costs a fraction of a cent).

## Deploy (Vercel)

1. Import the GitHub repo in Vercel (framework: Next.js, defaults are fine).
2. Add environment variables (Production): `OPENROUTER_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`. Never prefix them with `NEXT_PUBLIC_`.
3. Deploy, then open the URL in a private window and on a phone: no login, no key prompt. Load sample file, run Demo 1 and Demo 2,
   and toggle Local-only.
4. After the Wednesday-morning re-test, don't redeploy.

## Where things are

| Path | What |
|---|---|
| `docs/` | Spec PDF, official template, UI reference (source of truth) |
| `data/carriers.json`, `data/rulebook.json` | Template Sheets 3 and 4 (a test asserts equality) |
| `lib/rulebook.ts` | The only rule logic (R-01…R-10) |
| `lib/validate.ts`, `repair.ts`, `carrier.ts`, `parse.ts`, `chat.ts` | Engine |
| `app/api/*` | Model routes (key stays on the server; size/length/rate limits) |
| `components/` | UI |
| `BUILD_LOG.md` | Phase-by-phase log, gate evidence, assumptions and spec conflicts |

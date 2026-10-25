# Ship Easy — standing rules

Read `docs/SPEC.pdf` (the spec) and `docs/template.xlsx` from the repo, never from chat attachments.
`BUILD_LOG.md` records every phase, gate result, assumption and spec conflict.

## Design principle: deterministic truth, AI voice
- Every number, rule result, repair and carrier ranking comes from pure, tested TypeScript in `/lib`.
- The model (Google Gemini via OpenRouter — google/* models only, provider pinned to google-vertex/google-ai-studio; server routes only; key in OPENROUTER_API_KEY) may ONLY:
  (a) extract seller-supplied fields from chat as a PATCH, (b) classify implied hazardous goods for R-06,
  (c) write explanations. It never returns or sees the whole booking.
- The app must work fully with no model (Local-only mode, also the automatic fallback on 429 / timeout / missing key).

## Sources of truth
- Sheets 3 and 4 of `docs/template.xlsx` are the ONLY carrier data and rules.
  Carrier data lives ONLY in `data/carriers.json` (a test asserts it equals Sheet 3).
- Rule logic lives ONLY in `lib/rulebook.ts` as data objects `{ id, severity, text, check(ctx) }`.
  Never add rules or severities. Extra observations go in "FYI, not a rule" and never change the verdict.
- No magic numbers outside `data/` and `lib/config.ts`.

## Field trust model
- Mutable (may be proposed for correction): booking.pallets, booking.cartons, booking.declared_value,
  booking.gross_weight, item.hs_code, item.quantity, item.cartons.
- Trusted (never auto-corrected): item.unit_price, item.units_per_carton, item.unit_weight, and all
  route / date / priority / destination-type fields.

## Clock injection
- Anything depending on "today" takes the Europe/London date (ISO `YYYY-MM-DD`) as a parameter.
- Never call `Date.now()` / `new Date()` inside rule or carrier logic. Tests use 2026-10-25.

## Process
- Strict phase gates; commit `phase N: <summary>` after each gate passes and push to origin main. Never force-push.
- Never weaken/skip/delete a test to make it pass. Never edit `fixtures/expected.json` to match engine output;
  decide which side is wrong against the spec and log the reasoning in BUILD_LOG.md.
- Secrets: only in `.env.local` (git-ignored). Never print, log or commit them; never expose them to client code.
- Deps are minimal (Next 14, TS, Tailwind, SheetJS, Zod, Vitest). Ask before adding anything else.

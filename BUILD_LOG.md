# PreFlight (Ship-Easy) — Build log

Build date: 25-10-2026 (Europe/London). Builder: Claude Code (single agent).

---

## Phase 0A — Ingest resources

**What I did**

- Cloned `https://github.com/joymukhopadhyay-mesa/Ship-Easy.git` (it was empty, no commits).
- Created `.gitignore` before anything else (`.env*` except `.env.example`, `node_modules/`, `.next/`, `out/`, `build/`, `dist/`, `coverage/`).
- Wrote the API key to `.env.local` only. `git check-ignore -v .env.local` → `.gitignore:2:.env*  .env.local` (ignored).
- Copied the attachments byte-for-byte (`cp`, then `cmp` against the originals → `BYTE-IDENTICAL`):

| Repo path | Source |
|---|---|
| `docs/SPEC.pdf` | `Case2_FINAL_Solution_and_Execution_Plan.pdf` |
| `docs/template.xlsx` | `Case2_Shipment_Booking_Test_Data_Format.xlsx` |
| `docs/ui-reference/01-shipping-overview-dashboard.jpg` | chat image 1 |
| `docs/ui-reference/02-trucks-management-and-tracking.jpg` | chat image 2 |
| `docs/ui-reference/03-walkthrough-video.mp4` | `WhatsApp Video 2026-10-25 at 9.37.13 PM.mp4` |
| `docs/extra/case2-brief.docx` | `Ops Hackathon - Case 2 Shipment Booking & Error Checker.docx` (extra context) |
| `docs/extra/hackathon-guidelines.docx` | `AI x Ops Hackathon_Guidelines.docx` (extra context) |

**Read-back checks**

- `SPEC.pdf`: `pdftotext -layout` extracts 556 lines. The headings are upper-case: `PART A - The final solution` (line 51), `PART B - Step-by-step execution plan` (line 332), `PART C - Test plan` (line 414). A case-insensitive match finds "Part A", "Part B" and "Part C". Parts D and E are also present.
- `template.xlsx` (read with SheetJS): sheets = `Bookings, Items, Carrier options, Rulebook, Allowed values, Field guide, Glossary`. **Carrier options** (9 rows: 3 carriers × DE/FR/NL) and **Rulebook** (R-01..R-10) are both present. Header is on row 2, grey example on row 3 (BK-001 / MUG-01).
- `ui-reference/`: 3 files (2 JPG, 1 MP4, 45.5 s, 576×464). I looked at the video frame by frame in a browser.

**UI reference: what it shows**

1. *Shipping overview dashboard* (image 1): light grey page (#F3F4F6-ish), white cards with large radius (~20px), no heavy borders. Top bar has a pill-shaped segmented nav where the active tab is a black pill with white text ("Overview / Shipping / Tracking / Analytics / History"). Big greeting headline, then a black pill primary button on the right ("Add new"). A KPI row of three stats, each with a circular icon chip, a large number and a small green/red % delta. A 2-column grid: bar chart card (black plus pale-blue bars), a gauge card, a vehicle card with a truck photo and a green "On-Route" dot, and a tracking card with a vertical timeline (red dots, dates, times) and a courier row. At the bottom, a table card with pill filter tabs ("All Shipments / Delivered / In transit / Pending / Processing"), sortable column headers, a green status text and a pagination "1-10 of 60".
2. *Trucks management / tracking* (image 2): same light style. Pill nav with a black active pill; big title "Trucks Management" plus a subtitle; small stat tags in bright green and purple ("+33%", "-22%"); a truck illustration with a load-planning grid; a right-hand "Load Planning" list card with icon actions; shipment-number tiles where the selected one has a purple outline; a Gantt chart with purple bars. Inset: a "Tracking" app with a left sidebar nav (red active item), status filter chips, vehicle cards, a red capacity bar "82%", and a route map.
3. *Video*: an AI dispatch dashboard in the same light style (left icon sidebar, "Good morning Sarah" header, KPI chips, map with coloured route lines, right detail panel). The key interaction at about 12 s is a modal, **"Approve route change?"**: *Current* vs *Proposed* side by side (old time with a red "Severe problem" tag, new time with a green "Faster" tag), a list of the changed fields underneath, and Approve / Cancel buttons. This is the visual model I'll use for the change-log "before → after" strip and the Apply-fix confirmation.

**Design tokens taken from it:** background `#F2F3F5`; cards white, `rounded-2xl/3xl`, soft shadow; ink `#0B0B0C`; black pill for primary and active states; status colours green `#16A34A`, red `#DC2626`, amber `#D97706`, accent purple `#7C3AED`, pale blue `#C9D8EC` for secondary bars; Inter-like sans; large numbers with small muted labels.

**Gate 0A:** PASS. All three resources exist under `docs/`, read back correctly, and the commit is shown below.

**Conflicts and notes found in 0A**

- C-1 (key / provider): the prompt says to use a *Gemini* key with the *official Gemini SDK*. The key supplied is an **OpenRouter** key (`sk-or-v1-…`), sent with instructions to call Google models *only through OpenRouter* (`https://openrouter.ai/api/v1/chat/completions`, `google/*` models, `provider.only = [google-vertex, google-ai-studio]`, `allow_fallbacks:false`). That key cannot work with the Google SDK. **Resolution:** the server calls OpenRouter with plain `fetch` (no new dependency; Google models only, provider-pinned). The env var is `OPENROUTER_API_KEY` (as the OpenRouter instructions require) instead of `GEMINI_API_KEY`. `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` are kept as the model switches. The official Gemini SDK is **not** installed.
- C-2: the pasted build prompt is cut off mid-sentence inside Phase 4 ("…invoice draft with"). Phases 5+ are not visible. I follow the PDF's Part B for what comes next (Gemini layer, then deploy/harden) and log it here.
- C-3: the template uses full country names ("United Kingdom", not "UK"). The engine treats "UK"/"United Kingdom" as the same and writes "United Kingdom" into exports.

**Commit:** `3d8aadd phase 0A: add spec, template and UI reference`, pushed to `origin/main`.

---

## Phase 0 — Setup

**Architecture summary (from docs/SPEC.pdf Part A2 and this build prompt)**

```
Browser (Next.js 14 App Router + TypeScript + Tailwind)
 ├─ SheetJS parses .xlsx locally (nothing uploaded)
 ├─ /lib  (pure, unit-tested, zero network; "today" is injected)
 │    config.ts     allowed values, cities→country, tolerances, Balanced default weights
 │    rulebook.ts   R-01..R-10 as {id, severity, text, check(ctx)}   ← only place with rule logic
 │    trust.ts      mutable vs trusted field registry
 │    validate.ts   D-gate → rules → verdict
 │    repair.ts     Stage 1 single-field → Stage 2 bounded pair → Stage 3 honest fallback
 │    carrier.ts    lane filter, feasibility, 4 ranking modes, Balanced, R-05 states, dates
 │    parse.ts      header-by-name workbook parser + reconciliation line
 │    explain.ts    templated plain-English text (Local-only voice)
 │    chat.ts       deterministic booking state machine: merge PATCH, infer, compute, ask ≤3 questions
 │    localExtract.ts  regex extractor that emits the same PATCH shape (Local-only chat)
 │    hazards.ts    R-06 explicit keywords + built-in implied-hazard product list
 ├─ data/carriers.json  (equals template Sheet 3; asserted by a test)
 └─ server routes (hold the key; size limit, message limit, per-IP rate limit)
      /api/chat     → PATCH only (source-checked, allow-listed, merged in code)
      /api/explain  → one batched call per upload, narrative only
      /api/hazard   → R-06 implied classifier, output constrained to explicit/implied/none
   Fallback: Local-only mode (toggle and automatic on 429 / timeout / missing key / bad output)
```

**Ambiguities found and the conservative choice made (no stop needed)**

- A-1 **Verdict precedence.** The spec lists BLOCKED / SHIP WITH CARE / CLEAR / INCOMPLETE but does not say what wins when a gate D-code and a Red both apply. Choice: **Red > Incomplete > Amber > Clear.** A definite Red must never be hidden behind "incomplete". Incomplete beats Amber because unchecked rules mean we cannot claim "Ambers only".
- A-2 **Which D-codes make a booking INCOMPLETE:** D-01, D-02, D-05, D-06 (some checks could not run). D-04 (duplicate ID): both bookings are shown and flagged. Items carrying that ID are attached to both, and both are INCOMPLETE because the items cannot be attributed reliably. D-03 orphans are listed under Unmatched.
- A-3 **"Clears every failing rule" (repair Stage 1).** Taken literally, a booking with an R-01 error plus an R-03 error could never get a single-field fix, although no field is shared between them. Choice: the repair search runs over the connected numeric identity cluster **R-02, R-03, R-04, R-07** (rules that share mutable fields). R-01 (hs_code only) and R-05 (pallets, handled by the carrier engine's `ceil(gross/cap)` suggestions) are repaired separately. A candidate is accepted only if it clears every failing rule in the cluster **and breaks no passing rule anywhere** (R-05 included), so the invariant "no suggested value fails a rule" holds by construction.
- A-4 **Confidence for Stage 2 pairs.** The same High test as single fields: unique accepted pair, every alternative breaks a passing rule, integer for counts. Two accepted pairs → Ambiguous (show both, apply neither). Any gross-weight involvement → never High.
- A-5 **Seller override in files.** The template has no "chosen carrier" column. The parser recognises an optional extra column `Chosen carrier` (by name). Fixture 20 uses it, and the UI has a carrier picker. Without it, the chosen carrier is the recommended one.
- A-6 **R-06-I declaration.** The one-click declaration means "I confirm this item contains no lithium battery, aerosol or flammable liquid". Before it is clicked the item is Red "Blocked pending seller confirmation". After it, the rule passes for that item and the audit line "Confirmed by seller, DD-MM-YYYY HH:mm (Europe/London)" is shown. It never becomes Amber and never names a person.
- A-7 **Reconciliation accounting.** Rows read = every non-blank data row on Bookings + Items (header and grey example excluded). Each row lands in exactly one bucket: *validated*, *incomplete* (its own data is missing/quarantined: D-01/D-02/D-05/D-06), *unmatched* (D-03), or *duplicate* (D-04 booking rows). The buckets always sum to rows read, and a test asserts it.
- A-8 **Chat must work without the model.** "If Gemini is unavailable the app must still work fully" applies to Part 1 too, so a deterministic regex extractor (`localExtract.ts`) produces the same PATCH shape with source phrases. The model path and the local path share the same merge, source check and allow-list.
- A-9 **Seller name / Booking ID in chat.** They are not in the four question groups. The Booking ID is generated (`CHAT-001`). The seller name is optional ("Not given" until stated) and never blocks completion.
- A-10 **Unknown route values / blank priority in a file.** If the destination city/country can't be resolved, R-05 is "cannot compute" (like D-05) and no carrier is recommended. A blank priority falls back to Balanced and an "FYI, not a rule" note says so.
- A-11 **HS code digits.** Digits are counted after stripping a trailing ".0", dots and spaces ("6912.00" → 691200 → 6 digits). Any other non-digit character makes the code invalid (R-01 Red).

**Setup done**

- Manual scaffold (the repo already had files, so `create-next-app` was not used): Next.js 14.2.35, React 18.3, TypeScript 5.9, Tailwind 3.4, SheetJS 0.20.3 (from the official SheetJS CDN tarball; the npm `xlsx@0.18.5` has known advisories), Zod 3, Vitest 2.
- `.env.example` (placeholders only), `CLAUDE.md` (standing rules), Tailwind tokens from the UI reference, placeholder page.
- The oracle script runs on Node 26's native TypeScript type stripping (`node --experimental-strip-types`), so no `tsx` dependency is needed.

**Gate 0:** PASS. `npm run build` → `✓ Compiled successfully` (routes `/`, `/_not-found`). `npm test` → `Test Files 1 passed, Tests 1 passed`. `git status --ignored` → `!! .env.local` (untracked and ignored), `.env.example` tracked.

**Commit:** `5725dc4 phase 0: scaffold …`, pushed.

---

## Phase 1 — Fixtures and oracle

**What I did**

- `scripts/make-fixtures.mjs` loads `docs/template.xlsx` and fills Bookings/Items from row 4. The title row, header row 2, grey example row 3 and Sheets 3–7 are left untouched, so every fixture is in the official structure. It wrote 22 workbooks: `f01`–`f10` (one rule each, `f06` explicit hazard), `f06i` (implied hazard, extra case), `f11`–`f13` (two planted mistakes), `f14` zero items, `f15` orphan item, `f16` zero pallets, `f17` clean, `f18` Demo 1, `f19` Demo 2, `f20` seller override, `f21` weekend.
- `fixtures/expected.json` is hand-reasoned from the rules (not engine output). Every valid date is after 25-10-2026, and the R-10 fixture uses 20-10-2026.
- `fixtures/chat/`: `non-divisible.json`, `implied-hazard.json`, `untouched-field.json`.
- `scripts/oracle.mts` imports nothing from `/lib` or `/data`. It reads each workbook with SheetJS, takes the rate card from the workbook's own Sheet 3, and recomputes rules, verdict, kg/pallet, feasibility, ranking (including Balanced), cost, dates, min pallets, override fixes and reconciliation. It also checks that every expected repair actually clears the identities it targets and that "from" values match the file.

**Fixture design notes (reasoning recorded so the oracle and engine can't drift)**

- f01 uses coffee `90121` (5 digits, the classic lost leading zero of `090121`) → R-01 Red + caveat. No value is suggested, because a guessed HS code is not a safe repair.
- f03 (R-03 only) can only be produced when two mutually consistent numbers are wrong, so no single field clears it. Stage 2 finds **two** valid pairs (DV+quantity, or booking cartons+item cartons) → **Ambiguous**, apply neither.
- f11: DV 5600 and quantity 1000 both wrong → the only clearing pair is DV 5400 + quantity 1080 → **High**.
- f12: two item-level mistakes (MUG quantity, BWL cartons). One booking-level plus one item-level field can't clear both R-03 failures → **Stage 3**, Possible, apply disabled.
- f13: booking cartons wrong and gross weight under the goods weight. These share no mutable field, so they're repaired separately (A-3): R-04 High, R-07 floor Possible.
- Demo bookings use ready **Mon 02-11-2026** so that B (3d) → Thu 5 Nov and C (2d) → Wed 4 Nov. A Thursday ready date would roll both ETAs to the same Monday and make "1 day faster" look false on screen.
- f20 uses priority Fastest so that the recommendation among the feasible {A (cap 500 inclusive), B} is B. That matches the spec's "switch to B" example. The override column is the optional `Chosen carrier` (A-5).

**Gate 1 evidence**

```
$ npm run oracle
oracle: 22 fixtures, 22 bookings checked
oracle: expected.json agrees on every fixture
```
- Mutation test: I changed Demo 1's 3-pallet cost to 661 and the weekend ETA to 14 Nov in a copy → the oracle reported both disagreements → restored the file.
- Fixtures 01–10 and 06i: the oracle asserts each fails exactly its own rule (in both `rules` and `breaks`) → pass.
- Demo 1 (800 kg → none; 533 → B £660; 400 → A, B, C), Demo 2 (420 → A, B → B £660; 315 → C £1,360), weekend (Sat 7 Nov → Mon 9 Nov → A Mon 16 Nov), Thursday (5 Nov → A Tue 10 Nov) and Balanced (A 0.60 / B 0.35 / C 0.40 → B) all match the prompt.

**Gate 1:** PASS.

**Commit:** `314dfdc phase 1: …`, pushed.

---

## Phase 2 — Engine (pure functions, zero network)

**Modules:** `lib/types.ts`, `config.ts` (allowed values and constants), `dates.ts` (pure calendar maths; `londonToday(now)` exists only for the app/API to produce the injected date), `carrier.ts`, `hazards.ts`, `trust.ts`, `context.ts` (sums/carrier/hazards, no pass/fail decisions), `rulebook.ts` (**the only rule logic**, 10 rules as `{id, severity, text, check(ctx)}`; text and severity are loaded from `data/rulebook.json`), `repair.ts`, `validate.ts`, `explain.ts`, `changelog.ts`, `format.ts`. Rule text lives in `data/rulebook.json` (Sheet 4) next to `data/carriers.json` (Sheet 3).

**Decisions made while building (conservative, logged)**

- E-1 **Repair clusters.** Failing identity checks (R-02, R-03 per item, R-04, R-07) are grouped into connected components through the mutable fields each can be repaired through. R-02: declared value + quantities. R-03@item: that item's quantity + cartons. R-04: booking cartons + item cartons. R-07: gross weight only (an inequality can't imply a quantity). Each component runs Stage 1 → 2 → 3 independently. Every candidate is verified by re-running the real rulebook: it must clear every failing check in its component and break **no** passing check anywhere (R-05 included).
- E-2 **High confidence** = exactly one accepted candidate (every other candidate either breaks a passing check or doesn't clear the failures), integer for counts, 2 dp for money, never for weight. Two or more accepted with an equal score → Ambiguous. Two or more with different scores → the best is shown at Possible, with the others listed.
- E-3 If a High fix in one component also clears R-07, the separate weight-floor note is dropped (it would otherwise send the seller to change the wrong number).
- E-4 **R-05 remedies are seller actions, not data repairs.** Pallets are a physical decision, so "Re-pack onto N pallets (opens Carrier X)", "Switch to Carrier B (£630)" and "Keep C: use 4 pallets (+1)" are one-click actions that are re-validated after applying. Gross weight stays a Possible note only. R-08's "I've booked the appointment" is the same kind of seller action.
- E-5 **Stage 3** emits one report per broken check (spec: "report each broken rule separately"). `expected.json` writes fixture 12 as one aggregate entry; the test checks that the union of the reports' rules equals it and that every report is Possible, apply-disabled and carries the exact fallback line.
- E-6 **Balanced ties** are broken by cost, then transit (the spec doesn't say). Slider weights are normalised to sum to 1.
- E-7 **D-02 at booking level.** A blank booking number or required value (cartons, declared value, gross, ready date, destination type, appointment for warehouses, unresolvable destination) is flagged D-02 "Booking is missing …" and its rules are marked not checked. This extends D-02, which the spec defines for items. Missing item numbers affect only the identities they feed: quantity → R-02/03/07, price → R-02, units per carton → R-03, cartons → R-03/04, unit weight → R-07.
- E-8 **Verdict also becomes INCOMPLETE** if any rule ends up not checked or cannot compute without a D-code. "Clear" is never claimed over an unchecked rule.

**Tests (85):**
- `tests/engine.fixtures.test.ts` (59): every fixture against `expected.json`. Covers verdict, rule statuses, gate codes, kg/pallet, R-05 state, feasible / recommended / chosen, cost, Ready → Collection → ETA, min pallets, ETA per carrier, Balanced scores, repairs (stage, confidence, changes, options, floor, apply state), the hazard kind, the override actions, and the Demo variants with the exact change-log lines.
- `tests/engine.rules.test.ts` (26): `carriers.json` equals Sheet 3; `rulebook.json` and `RULES` equal Sheet 4. R-02 at exactly 1% passes and at +£0.01 over fails, on both sides. R-10: today passes, yesterday fails. R-01 cases: `.0`, dots, letters, 5-digit caveat. R-05 cap is inclusive. R-06-I stays Red until the declaration; the audit line names no identity; explicit beats a confirmation; the model can only add "implied"; the Local list covers the spec examples. Verdict precedence. D-02 exclusion. The worked case (quantity 1080, High, both arithmetic lines). Weight is never High. Stage 3 has no apply. Trusted fields are refused. The Balanced worked check plus max == min. Ranking modes. Weekend dates. Demo 1 and 2. **The invariant:** 400 deterministic perturbed bookings, where every Stage 1/2 suggestion (all Ambiguous options included) and every seller action clears its target and breaks nothing. **Clock injection:** a static check that no engine module calls `Date.now()` or `new Date(`.
- `npx tsc --noEmit` → clean.

**Gate 2 evidence**

```
$ npx vitest run
 ✓ tests/engine.fixtures.test.ts (59 tests)
 ✓ tests/engine.rules.test.ts (26 tests)
 Test Files  2 passed (2)
      Tests  85 passed (85)        ← zero skipped
```
- Stage 3 (f12): four separate reports, all Possible / apply disabled / fallback line, and no apply anywhere on the booking. I printed the real output to confirm it isn't vacuous.
- Demo 1 (2 → 3 pallets) log: `Pallets 2 -> 3 | Weight/pallet 800 -> 533 kg | R-05 Red (no carrier fits) -> Pass | Carrier none -> B (3d, GBP 660)`. Demo 2 (3 → 4): `Pallets 3 -> 4 | Weight/pallet 420 -> 315 kg | No checks changed | Carrier B (3d, GBP 660) -> C (2d, GBP 1,360) +GBP 700, 1 day faster`. Weekend: collection Mon 9 Nov, A ETA Mon 16 Nov. Thursday: A ETA Tue 10 Nov.

**Gate 2:** PASS.

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

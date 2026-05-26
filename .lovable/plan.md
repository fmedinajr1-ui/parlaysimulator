
## Verifier Agent — "Deep Research" gate for prop alerts

A second-opinion agent that reads every inbound prop alert, pulls fresh research (Perplexity sonar-deep-research), reasons over it with GPT-5, and stamps a verdict the parlay engine reads before turning the alert into a leg.

Operating mode (confirmed):
- **Soft tag + confidence haircut** — no hard block. Verdict + reasoning attach to the alert; parlay engine applies a multiplier.
- **Deep research** — Perplexity `sonar-deep-research` for evidence, OpenAI `gpt-5` for the final judgement.
- **Hybrid trigger** — realtime on every new alert + batch sweep before each parlay generation cycle as a safety net.

---

### 1. New table: `prop_alert_verdicts`

One row per (alert_id, source_table) — the verifier's opinion on a single prop alert.

Columns (domain only — id/created_at/updated_at standard):
- `alert_id` (uuid) + `source_table` (text: `fanduel_prediction_alerts` | `sharp_signals` | `extreme_movement_alerts` | `market_signals`)
- `player_name`, `sport`, `prop_type`, `side`, `line`, `event_id`
- `verdict` enum: `APPROVE` | `CAUTION` | `REJECT`
- `verdict_confidence` (0–100)
- `confidence_multiplier` (numeric, e.g. 1.10 / 0.75 / 0.40 — what the engine applies)
- `reasoning` (text, 2–4 sentences plain English)
- `evidence` (jsonb: citations[], injury notes, lineup, weather, sharp moves, L10 vs opp rank, line history)
- `research_model`, `judge_model`, `tokens_used`, `cost_usd`, `research_ms`
- `flags` (text[]: e.g. `INJURY_UPDATE_AFTER_LINE`, `WEATHER_FADE`, `LINEUP_CHANGE`, `STALE_LINE`, `BOOK_OVERREACTION`, `MATCHUP_MISMATCH`)
- `status` (`pending` | `researching` | `complete` | `error`), `error_message`

Indexes on `(source_table, alert_id)` unique, `(created_at desc)`, `(sport, verdict)`.

RLS: admin-only writes (service role); authenticated read. GRANTs included.

---

### 2. New edge function: `prop-alert-verifier`

Two modes:

**a) Single-alert mode** (realtime)
- Body: `{ alert_id, source_table }`
- Load the alert + sibling context (event, opp team, lineup_alerts, market_signals history for this player/prop, L10, defense rank).
- **Research call** → Perplexity `sonar-deep-research`:
  - Targeted prompt per sport (NBA / MLB / NHL / etc.) asking for: confirmed injury/lineup news within 24h, weather (MLB/NHL outdoor), recent usage trend, sharp line history for THIS prop, opp defense rank vs this prop type, any news that justifies or invalidates the alert's direction.
  - Returns evidence + citations.
- **Judge call** → OpenAI `gpt-5` via Lovable AI Gateway:
  - Structured output (Zod schema) → `{ verdict, confidence, multiplier, reasoning, flags, key_evidence[] }`.
  - System prompt instructs: take your time, weigh research vs alert direction, be skeptical of stale lines and reactive snap moves (poison signals memory), and require concrete reasons to REJECT.
- Write to `prop_alert_verdicts`.
- Patch the source alert's `metadata.verifier` with `{ verdict, multiplier, reasoning }` so existing engines pick it up without schema changes.

**b) Batch mode** (sweep)
- Body: `{ mode: 'sweep', since_minutes: 30, limit: 200 }`
- Finds alerts from the last N minutes across all 4 source tables with no row in `prop_alert_verdicts`, calls itself per alert with bounded concurrency (e.g. 4).

Guardrails:
- Per-alert timeout 90s (deep research can be slow — that's intentional).
- Dedup: skip if verdict exists within 2h for same (player, prop, side, line).
- Cost cap: max 300 verdicts/day, daily counter table; over cap → degrade to internal-only (Gemini 2.5 Flash, no Perplexity).
- Returns clean errors to the caller; never throws into the cron caller.

---

### 3. Engine integration (soft tag, no hard block)

Single small change in `parlay-engine-v2/scoring.ts` (and `signal-alert-engine` if it filters before parlay):
- When building a candidate leg, read `metadata.verifier.multiplier` (default 1.0).
- Multiply `leg.confidence` by it before existing tier/signal weights.
- If `verdict === 'REJECT'` AND `multiplier <= 0.45`, drop the leg from non-lottery strategies only (Lock/Strong/Stretch). Lottery still allowed.
- Telegram broadcast adds a 🔍 footer line when verdict ≠ APPROVE: e.g. `🔍 Verifier: CAUTION — pitcher pulled in 4th, line stale`.

No schema change to `fanduel_prediction_alerts` etc. — verdict travels in existing `metadata` jsonb.

---

### 4. Triggers

**Realtime:** Postgres trigger on insert into each of the 4 alert tables → `pg_net.http_post` to `prop-alert-verifier` with `{alert_id, source_table}`. Fire-and-forget; engine works fine if verdict not yet written (defaults multiplier 1.0).

**Batch sweep cron:** every 5 minutes, call `prop-alert-verifier` with `{mode:'sweep', since_minutes:30}`. Also one sweep kicked off at the top of the parlay generation phase so anything new gets a verdict before parlays are built.

---

### 5. Admin UI: `/admin/verifier`

Single page added under existing admin nav:
- Live table of recent verdicts (last 24h): player, prop, side, verdict pill, multiplier, flags, "View reasoning" expandable, citations.
- Filters: sport, verdict, source_table.
- KPIs: % APPROVE / CAUTION / REJECT, avg multiplier, cost today, agreement rate (verdict APPROVE → alert was correct on settlement) — pulled by joining `prop_alert_verdicts` to settled `fanduel_prediction_alerts.was_correct`.
- Manual "Re-verify alert" button on any row.

---

### 6. Testing (5 required per memory rule)

Deno tests in `supabase/functions/prop-alert-verifier/index_test.ts`:
1. Loads alert + builds correct research prompt per sport (NBA vs MLB).
2. Structured judge output parses to schema; rejects malformed.
3. Dedup: second call within 2h for same prop returns cached verdict, no Perplexity call.
4. Cost cap: at 300/day, falls back to Gemini 2.5 Flash, sets `flags: ['DEGRADED']`.
5. Engine multiplier: leg.confidence pre × verifier multiplier = expected; REJECT @ 0.40 drops from Lock pool but stays in Lottery.

---

### Secrets needed
- `PERPLEXITY_API_KEY` (new) — Connectors → Perplexity, or add via secrets.
- `LOVABLE_API_KEY` (already present).

---

### Memory entry to add (post-build)
`mem://logic/betting/prop-alert-verifier` — Verifier Agent: soft-tag (APPROVE/CAUTION/REJECT) + confidence multiplier, Perplexity sonar-deep-research + GPT-5 judge, realtime per-alert + 5-min batch sweep, cost-capped at 300/day with Gemini fallback.

---

### Files to create/edit
- new: `supabase/functions/prop-alert-verifier/index.ts`
- new: `supabase/functions/prop-alert-verifier/index_test.ts`
- new: `src/pages/admin/PropAlertVerifier.tsx` + route
- edit: `supabase/functions/_shared/parlay-engine-v2/scoring.ts` (consume multiplier)
- edit: `supabase/functions/signal-alert-engine/index.ts` (append verifier footer to Telegram)
- migration: `prop_alert_verdicts` table + triggers on 4 alert tables + 5-min cron
- new memory: `mem/logic/betting/prop-alert-verifier.md` + index entry

Ready for build mode on your go.

## Goal
Capture a true "closing line" for every `mlb_fair_price_events` row so we can compute CLV — the leading signal that tells us whether MLB Fair-Price v1 is finding real edge, weeks before we have enough settled games to refit the WP model.

## What "closing line" means here
For each fired event, the closing line is the **last observed de-vigged book implied probability for the side we fired**, captured at or just before game-final. CLV is `(closing_devig − devig_at_fire) / devig_at_fire`, signed toward our side. Positive CLV = market moved our way = edge is likely real.

## What's missing today
- No continuous snapshot of MLB live moneyline prices keyed by `game_id`.
- `mlb-fair-price-outcome-attacher` only fills score/realized_hit; `closing_book_implied_devig`, `closing_attached_at`, `clv_pct` stay null.
- No record of the **opposite-side** price at fire time on the event row itself (we have `book_price` and `book_devig_at_fire`, but not the raw opposite quote that produced the de-vig). Useful for audit.

## Build

### 1. Snapshot table for MLB live ML ticks
New table `mlb_live_ml_snapshots`:
- `game_id`, `book_id`, `captured_at`
- `home_price` (american), `away_price` (american)
- `home_implied`, `away_implied`, `home_devig`, `away_devig`
- `suspended bool`, `source text` (e.g. `fanduel`, `the-odds-api`)
- index on `(game_id, captured_at desc)`
- RLS: service_role full, authenticated read-only (admin dashboards)

### 2. Snapshotter edge function `mlb-ml-snapshotter`
- Cron every 60s while any MLB game is `in_progress` or `scheduled` within ±30 min of start.
- Pulls current MLB ML quotes from the existing odds source already used by scout-live-edge (reuse, do not add a new provider).
- Writes one row per `(game_id, book_id)` per tick. Skips writes when price unchanged from last tick (dedupe on price hash) to keep table lean.

### 3. Augment fire-time recording in `scout-live-edge` MLB Fair-Price branch
On every fire, also write to `mlb_fair_price_events`:
- `opposite_book_price` (american) — raw opposite quote used in the de-vig
- `book_id` — which book the fire priced against
- `side` ('HOME' | 'AWAY') — explicit, derived from edge sign
- `pre_state_json`, `post_state_json` — already there as `pre_state`/`post_state`; confirm full game-state snapshot (inning, outs, baserunners, score) is captured, add any missing fields

Migration adds the missing columns + backfill defaults.

### 4. Closing-line resolver `mlb-fair-price-closing-resolver`
- Cron every 30 min (same cadence as outcome-attacher, runs right after it).
- For each event where `outcome_attached_at IS NOT NULL` AND `closing_attached_at IS NULL`:
  - Look up the latest `mlb_live_ml_snapshots` row for `game_id` (same `book_id` as fire if available, else the most-traded book).
  - Take that snapshot's `home_devig` or `away_devig` matching the fired side.
  - Write `closing_book_implied_devig`, `closing_attached_at = now()`, and `clv_pct` (signed toward fired side).
- If no snapshot exists for the game (e.g. snapshotter wasn't running yet), mark `closing_attached_at` with a sentinel and `clv_pct = null` so we don't retry forever.

### 5. Extend the daily digest
`mlb-fair-price-digest` adds:
- Avg CLV % on resolved fires (24h, 7d)
- % of fires with positive CLV
- Count of events still missing closing line (data quality signal)

### 6. Audit / "are we recording everything?" check
Add a SQL view `mlb_fair_price_event_completeness` that reports, per day:
- fires
- with outcome attached
- with closing line attached
- with both
- avg latency from fire → outcome_attached, fire → closing_attached

Surface a one-line health check in the daily digest so any gap is visible.

## Out of scope (call out, don't build)
- Refitting BETA / flipping `CALIBRATED = true` — still gated on ~2 weeks of data.
- Tier-2 (1B/2B/3B/IP_OUT) and LIVE_TOTAL — still deferred per the v1 constraint.
- Lifting `admin_only` or WARN severity — unchanged.

## Files touched
- New migration: `mlb_live_ml_snapshots` table + extra columns on `mlb_fair_price_events` (`opposite_book_price`, `book_id`, `side`)
- New edge function: `supabase/functions/mlb-ml-snapshotter/index.ts`
- New edge function: `supabase/functions/mlb-fair-price-closing-resolver/index.ts`
- Edit: `supabase/functions/scout-live-edge/index.ts` (MLB Fair-Price branch — write extra fire-time fields)
- Edit: `supabase/functions/mlb-fair-price-digest/index.ts` (add CLV + completeness rows)
- Two new cron entries via `supabase--insert`

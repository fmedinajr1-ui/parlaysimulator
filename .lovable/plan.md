

# Scanlines Intelligence: Current State and Line-Tracking Upgrade

## Current State

### 1. Daily Usage
`detect-mispriced-lines` runs **once daily** at 10:00 AM ET as part of the `refresh-l10-and-rebuild` pipeline (step in the cascade). It can also be triggered manually via `/scanlines` or `/runmispriced` in Telegram.

### 2. Tracing
Results are logged to `cron_job_history` with counts and tier breakdowns. The `mispriced_lines` table stores each scan's output — but it **upserts by `(player_name, prop_type, analysis_date)`**, meaning each re-run **overwrites** the previous scan for that day. There is **no history of how odds/lines changed throughout the day**.

### 3. Multi-Run Gap
You can run it multiple times, but you lose the previous snapshot each time. There's no way to see "+100 at 10am → -150 at 3pm" because the old row gets overwritten.

---

## What Needs to Change

### New Table: `mispriced_line_snapshots`
Store every scan as a timestamped snapshot instead of overwriting:

| Column | Type |
|--------|------|
| id | uuid PK |
| player_name | text |
| prop_type | text |
| sport | text |
| book_line | numeric |
| over_price | numeric |
| under_price | numeric |
| edge_pct | numeric |
| signal | text (OVER/UNDER) |
| confidence_tier | text |
| scan_time | timestamptz |
| analysis_date | date |

### Update `detect-mispriced-lines`
- After upserting to `mispriced_lines` (keep existing behavior), **also insert** a snapshot row into `mispriced_line_snapshots` with the current timestamp.
- Fetch and store `over_price` / `under_price` from the Odds API response (currently not persisted in `mispriced_lines`).

### New Table: `mispriced_line_verdicts`
Pre-game final verdict computed ~60 min before tip:

| Column | Type |
|--------|------|
| id | uuid PK |
| player_name | text |
| prop_type | text |
| sport | text |
| analysis_date | date |
| first_scan_line | numeric |
| first_scan_price | numeric |
| final_scan_line | numeric |
| final_scan_price | numeric |
| price_movement | numeric (computed) |
| line_movement | numeric (computed) |
| whale_signal | text (STEAM/FREEZE/NONE) |
| verdict | text (SHARP_CONFIRMED/TRAP/HOLD) |
| verdict_reason | text |
| commence_time | timestamptz |

### New Edge Function: `finalize-mispriced-verdicts`
- Runs 60 min before each game's `commence_time` (scheduled via cron every 15 min window)
- Compares earliest snapshot vs latest snapshot for each player-prop
- If price moved from +100 → -150: verdict = **SHARP_CONFIRMED** (whale money followed)
- If price moved from -120 → +110: verdict = **TRAP** (market faded the move)
- If minimal movement: verdict = **HOLD**
- Sends Telegram alert with the final verdicts

### Schedule Multi-Scan
Add 2 additional cron runs of `detect-mispriced-lines`:
- **12:30 PM ET** — midday re-scan
- **3:00 PM ET** — pre-tip re-scan (for 7pm games)

This gives 3 snapshots per day to track directional movement.

### Telegram Enhancement
Update `/scanlines` to show price history when multiple snapshots exist:
```
🔍 Jokic Points O24.5
10:00am: -110 → 12:30pm: -130 → 3:00pm: -155
📈 WHALE CONFIRMED — line moved 45 cents toward OVER
```

## Technical Summary
- 1 new snapshot table + 1 verdicts table (migrations)
- 1 new edge function (`finalize-mispriced-verdicts`)
- Update `detect-mispriced-lines` to write snapshots
- 2 new cron jobs for midday + afternoon scans
- Update Telegram `/scanlines` handler to show movement trail


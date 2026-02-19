
# Re-score Feb 18 NCAAB Picks — Full Analysis & Remediation Plan

## What Actually Happened on Feb 18

### The Broken Picks
The Feb 18 pipeline generated 7 NCAAB parlay legs from 4 games, all settled as **lost**:

| Game | Line | Actual Total | Outcome |
|---|---|---|---|
| George Mason vs Dayton | U 136.5 | 149 | MISS |
| Furman vs East Tennessee St | U 140.5 | 147 | MISS |
| East Carolina vs Wichita St | U 144.5 | 181 | MISS |
| Delaware vs Western Kentucky | U 141.5 | 175 | MISS |

Every leg had identical `composite_score: 95` (the clamp ceiling, i.e. a hardcoded junk score) and `sharp_score: 50–65`. The `score_breakdown` was null for all legs (the serialization bug fixed in the previous task). The `projected_total` fallback was 100 for every game.

### Why the Formula Was Broken
The old scoring engine was producing `projected_total = 100` (the floor fallback) for these games because the KenPom lookup was failing or returning zero values. The corrected possession-adjusted formula produces:

| Game | Corrected Projected Total | Sportsbook Line |
|---|---|---|
| George Mason vs Dayton | **166.1** | 136.5 |
| Furman vs East Tennessee St | **168.9** | 140.5 |
| East Carolina vs Wichita St | **172.1** | 144.5 |
| Delaware vs Western Kentucky | **169.5** | 141.5 |

### What the Corrected Engine Would Have Done
With projectedTotals of 166–172 against sportsbook lines of 136–144:
- `lineEdge = projectedTotal - line ≈ +29 to +30`
- This is a **POSITIVE** edge (projection is WAY over the line) — meaning the under is a terrible pick
- The circuit breaker (`projected_total <= 100 AND line > 125`) would NOT have been triggered since projectedTotal is now >100
- Instead, the scoring engine would apply a **line penalty**: for UNDER picks where `lineEdge > +3` (projection above the sportsbook line), the pick gets no under bonus and may get penalized
- Result: all 4 games would have scored **LOW** (well below the 62 threshold) and been filtered out of parlays entirely

In other words: **the corrected engine would not have generated any NCAAB picks on Feb 18**. The games were correctly bad UNDER bets (projections 30 points above the sportsbook line).

---

## What Can (and Cannot) Be Done

### What CAN be done
1. **Delete the 7 lost Feb 18 NCAAB-only parlays** from `bot_daily_parlays` so they don't pollute the learning dataset with false "NCAAB under" misses
2. **Re-run `team-bets-scoring-engine` for Feb 18 game_bets** — this will write correct `composite_score` and `score_breakdown` values to the `game_bets` rows, giving historical accuracy for future calibration
3. **Re-run `bot-review-and-optimize`** with `parlay_date: '2026-02-18'` — with the corrected engine, NCAAB picks will score low and be excluded. The optimizer will regenerate Feb 18 parlays without any NCAAB legs. This produces a **clean Feb 18 parlay record** from NBA/NHL legs only

### What CANNOT be done
- The actual game outcomes (actual_value fields) on already-settled legs are correct and stay
- We cannot retroactively "win" the parlays — the games are over and the unders lost by 10–37 points
- Historical parlays from before Feb 18 are unaffected

---

## Implementation Plan

### Step 1 — Delete the 7 Bad Feb 18 NCAAB Parlays
Run a SQL DELETE against `bot_daily_parlays` targeting the 7 parlay IDs that contain NCAAB legs with `composite_score: 95`:
- `76382c68`, `add17935`, `4fdf7b2a`, `2461ae88`, `2de8e298`, `cf982182`, `16d81268`

All are already settled as `lost` so removing them does not affect any pending bets.

### Step 2 — Re-run `team-bets-scoring-engine`
Call the edge function with a Feb 18 backfill mode. This rewrites `composite_score` and `score_breakdown` on the `game_bets` rows for those 4 NCAAB matchups, so calibration queries against `game_bets` reflect the correct projected totals.

### Step 3 — Re-run `bot-review-and-optimize` for Feb 18
Call `bot-review-and-optimize` with `{ source: 'backfill', parlay_date: '2026-02-18' }`. The optimizer will:
- Read the now-corrected `game_bets` scores
- Find NCAAB under picks scoring below 62 → exclude them
- Re-build the parlay slate from NBA/NHL legs only
- Insert clean `bot_daily_parlays` rows dated `2026-02-18`

### Step 4 — Re-run `bot-settle-and-learn` for Feb 18
Once new parlays are inserted, call `bot-settle-and-learn` targeting Feb 18. This re-settles the new parlay legs against the stored actual game scores and updates the learning model with accurate outcomes.

---

## Files to Change

The approach uses **edge function invocations only** — no code changes needed. The corrected engine is already deployed. The plan executes the following sequence:

1. **SQL via Supabase data tool**: DELETE 7 specific parlay rows from `bot_daily_parlays`
2. **Edge function call**: `team-bets-scoring-engine` — re-score Feb 18 game_bets
3. **Edge function call**: `bot-review-and-optimize` with `{ source: 'backfill', parlay_date: '2026-02-18' }`
4. **Edge function call**: `bot-settle-and-learn` — re-settle the regenerated Feb 18 parlays

No TypeScript files change. The corrected formula is already in place from the previous fix (projected_total floor issue in `team-bets-scoring-engine`).

---

## Technical Notes

- The `bot-review-and-optimize` function reads from `game_bets` where `is_active = true` and `commence_time` falls on the target date. For Feb 18, this requires passing `parlay_date` in the body so it filters `commence_time >= '2026-02-18' AND < '2026-02-19'`.
- The `bot-settle-and-learn` function needs the ESPN scoreboard data for Feb 18 (NCAAB `&groups=50`) — it can still fetch historical scores since ESPN provides them.
- The `game_bets` table itself (which stores raw odds data) does NOT need to be deleted — only the derived `bot_daily_parlays` rows are removed. The raw odds history is preserved for audit.
- This is forward-safe: the pipeline cron job for Feb 19 is unaffected since it targets today's date.

# Active Plans & Recent Changes

See `.lovable/archive/` for completed features prior to March 9, 2026.

# Universal Recency Decline Flag (L3 Gate) — IMPLEMENTED ✅ (March 9, 2026)

## Problem
Picks like Naji Marshall Over 14.5 PTS passed filters because L10 avg (17.0) cleared the line, but his last 4 games were 8, 13, 6, 4.

## Solution
Added `l3_avg` column + universal recency decline filter across ALL engines.

### Thresholds
- **HARD BLOCK (OVER)**: `l3_avg < l10_avg * 0.75` (25%+ decline)
- **HARD BLOCK (UNDER)**: `l3_avg > l10_avg * 1.25` (25%+ surge)
- **WARNING FLAG**: `l3_avg < l10_avg * 0.85` (15%+ decline, shown in broadcasts as 📉)

# NHL Matchup Intelligence Filter — IMPLEMENTED ✅ (March 11, 2026)

## Problem
NHL prop scanner fetched `nhl_team_defense_rankings` but **hardcoded matchupAdjustment to 0**. Floor lock picked purely on L10 hit rate — ignoring whether the player faces the league's best or worst defense.

## Solution
Wired prop-specific defensive/offensive matchup scoring into the scanner and floor lock orchestrator.

### Changes

#### 1. `nhl-prop-sweet-spots-scanner/index.ts` — Matchup scoring engine (v3)
- **Prop-specific defense routing**: Goals → `goals_against_rank`, SOG → `shots_against_rank`, Saves → `shots_for_rank`, PP Points → `penalty_kill_rank`
- **Matchup score formula**: `(oppDefRank * 0.6) + ((31 - teamOffRank) * 0.4)`
- **Tier classification**: Elite (≥22, +10), Prime (≥18, +5), Favorable (≥14, +2), Neutral (10-14, 0), Avoid (<10, -10)
- **Hard block**: OVER picks vs top-3 defenses in the specific stat category are excluded entirely
- **Team extraction**: Parses `game_description` for team abbreviations to resolve opponent
- **Confidence adjustment**: `confidence_score` now reflects matchup quality (base hit rate + adjustment)

#### 2. `nhl-floor-lock-daily/index.ts` — Matchup-aware filtering
- **Floor Lock**: Excludes legs with `matchup_adjustment < -5`
- **Optimal Combo**: Pool sorted by weighted score `(hit_rate * 0.7) + (matchup_normalized * 0.3)` instead of pure hit rate
- **Broadcast**: Each leg now shows matchup context (e.g., "vs OTT (ELITE — score 25.2)")
- **Matchup distribution logging**: Shows breakdown of elite/prime/favorable/neutral/avoid counts

#### 3. `nhl-team-defense-rankings-fetcher/index.ts` — Already had `power_play_rank`
- Confirmed existing computation is correct; no changes needed.

### Verified
- Scanner ran successfully: 63 props analyzed, 30 elite, 63 matchup-boosted
- Elite matchups scoring 25.2, prime at 18, favorable at 15.6
- Prop-specific routing confirmed (Goals uses goals_against_rank, SOG uses shots_against_rank)

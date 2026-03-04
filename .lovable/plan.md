

# Redesign Ladder Challenge: Single Best Pick of the Day

## Current Problem
The ladder challenge currently picks the **top 3** candidates (line 401: `candidates.slice(0, 3)`) and saves each as a separate single-leg entry. It was meant to be **one** pick — the single most accurate, highest-conviction play across the entire slate. It's also limited to 3PT props only.

## What It Should Be
The Ladder Challenge = **1 pick per day**. The single most data-backed, highest-confidence prop on the slate — any prop type (points, rebounds, assists, 3PT, etc.), not just threes. It should be the "lock of the day."

## Changes

### 1. Expand prop types beyond 3PT
- Fetch all player prop markets from The Odds API (points, rebounds, assists, threes, etc.)
- Cross-reference each with `category_sweet_spots` data for L10 stats across all categories
- Score candidates using the same composite formula but across all prop types

### 2. Pick only the #1 candidate
- Change `candidates.slice(0, 3)` → `candidates.slice(0, 1)` (line 401)
- Change dedup cap from 3 → 1 (line 93: `>= 3` → `>= 1`)

### 3. Select the safest line, not the boom line
- Instead of picking the highest line where L10 avg ≥ line (boom), pick the line with the **highest L10 hit rate** — the most likely to hit
- Prioritize 100% L10 hit rate picks, then 90%+, with floor protection

### 4. Update Telegram message format
- Single pick announcement: "🔒 LADDER LOCK OF THE DAY" instead of "🪜 LADDER CHALLENGE (3 Picks)"
- Show full supporting data: L10 hit rate, avg, floor, matchup grade

### 5. Keep the daily cron
The cron job already set up (daily at 18:00 UTC) stays — it'll just generate 1 pick instead of 3.

## Summary of Code Changes in `nba-ladder-challenge/index.ts`
1. **Line 93**: Change `>= 3` to `>= 1`
2. **Lines 100-170**: Expand Odds API fetch to include all prop markets (player_points, player_rebounds, player_assists, player_threes)
3. **Lines 400-485**: Take only top 1 candidate, pick the safest line (highest hit rate), update Telegram format to "Lock of the Day"
4. **Line 488**: Update message header




# Golden Signal Engine Improvements — Cold Streak Fix

## Problem Analysis

The data from April 1-3 shows **0 wins across 20+ losses** in the main parlay engine (Grind Stack, Optimal Combo, Shootout Stack). Key findings:

1. **Repeat offender players** are poisoning multiple parlays simultaneously:
   - Andrew Wiggins PTS UNDER — 6 loss appearances
   - Jayson Tatum PTS OVER — 4 losses
   - Sam Hauser REB OVER — 4 losses
   - LaMelo Ball 3PT OVER — 4 losses
   - Jonathan Kuminga REB OVER — 3 losses

2. **Gold Signal legs aren't being settled** — 16 `gold_tier1` signals sitting unsettled (no `was_correct` value), so the feedback loop can't learn from them.

3. **Same player appearing in 4-6 parlays** — one bad game wipes out the entire day.

4. **No cold-streak circuit breaker** — the system keeps generating full volume even during 0-20 streaks.

---

## Plan (5 Changes)

### 1. Add New Serial Killers to Blacklist
Update both `gold-signal-parlay-engine` and `bot-generate-daily-parlays` to block the 6 new repeat offenders discovered in the data:
- Andrew Wiggins | points | under
- Jayson Tatum | points | over
- Sam Hauser | rebounds | over
- LaMelo Ball | threes | over
- Jonathan Kuminga | rebounds | over
- Jalen Green | points | over

### 2. Add Daily Player Exposure Cap
Limit any single player to appearing in a maximum of **2 parlays per day** across all strategies. Currently one bad player (e.g., Wiggins) appears in 6 parlays, turning a single miss into a 6-loss day. This is the single biggest lever to reduce correlated losses.

### 3. Add Cold-Streak Circuit Breaker
Before generating parlays, check the last 2 days of results. If the system is on a **0-win streak of 10+ parlays**, automatically:
- Reduce generation volume by 50%
- Require minimum leg hit rate of 65% (up from current ~50%)
- Skip all Tier 2 legs (only use Tier 1 anchors with 80%+ historical win rate)

### 4. Fix Gold Signal Settlement Gap
The `gold_tier1` and `gold_tier2` signal types aren't being settled by the Bayesian feedback loop. Add these signal types to the settlement logic so the engine can learn from outcomes and auto-adjust.

### 5. Reduce 4-Leg Parlays, Prioritize 2-Leg
The data shows 4-leg parlays (Optimal Combo execution) are losing at a higher rate. Shift the mix:
- Cap execution-tier 4-leg parlays at **2 per day** (down from current ~5)
- Add **3 more 2-leg execution slots** using only Tier 1 gold combos
- 2-leg parlays have higher individual win rates even at lower payouts

---

## Technical Details

**Files modified:**
- `supabase/functions/gold-signal-parlay-engine/index.ts` — serial killers, exposure cap, circuit breaker
- `supabase/functions/bot-generate-daily-parlays/index.ts` — serial killers, exposure cap, 4-leg reduction
- `supabase/functions/settle-fanduel-predictions/index.ts` (or equivalent) — add `gold_tier1`/`gold_tier2` to settlement

**No database migrations needed** — all changes are edge function logic updates.


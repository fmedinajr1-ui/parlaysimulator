

# Strengthen Moneyline Take It Now: Matchup Quality Gate

## Current Problem

The Take It Now moneyline logic for **all sports** uses a bare confidence formula: `30 + driftPct * 3`. A tiny 9.6% drift gives 59% confidence — just enough to pass the 55% threshold. There's **no matchup tightness or team quality factor** in the confidence score.

The `teamCrossReferenceGate` exists but only hard-blocks obvious traps (sub-.500 vs .500+ teams). It doesn't **adjust confidence** or require bigger drift for mismatches. Result: Memphis Grizzlies +660 (massive underdog) gets a TAKE alert on a small drift, and Colorado Rockies (worst MLB team) gets 91% confidence just because the drift was big.

## Fix

### 1. Add Matchup Tightness Score to Confidence Formula

For ALL moneyline Take It Now alerts (NBA, MLB, NHL), compute a **matchup quality modifier** from existing `teamStatsMap` data:

```text
matchupGap = abs(teamWinPct - oppWinPct)

Tight matchup (gap < 5%)  → +10 confidence (these are real edges)
Normal matchup (gap 5-15%) → +0 (neutral)  
Mismatch (gap 15-25%)     → -10 confidence
Heavy mismatch (gap > 25%) → -20 confidence

Star team bonus (winPct > 60%) being TAKEN → +8
Bottom team (winPct < 35%) being TAKEN → -15
```

This means a 9.6% drift on Memphis (+660, ~30% win rate) would score: `30 + 28.8 - 15 (bottom team) - 20 (heavy mismatch) = 23.8` → **blocked** (below 55).

Meanwhile a 9.6% drift on a tight matchup between two .500 teams: `30 + 28.8 + 10 = 68.8` → **passes with context**.

### 2. Minimum Drift Gate for Mismatches

Add a hard floor: if matchup gap > 20% AND drift < 15%, skip the alert entirely. Small line moves on lopsided games are noise — books adjusting handle, not sharp money.

### 3. Show Matchup Context in Telegram

Add a matchup line to the alert body (after the cross-ref badge):

- Tight: `🤝 Tight matchup: 52% vs 49% — small edge matters`
- Mismatch: `⚠️ Mismatch: 62% vs 38% — need strong drift to trust`
- Heavy mismatch: `🚫 Heavy mismatch: 68% vs 31% — high drift required`

### 4. Apply to MLB Moneyline Too

The MLB branch (line 1142-1200) currently adds pitcher context but doesn't factor team win% into confidence. Add the same matchup modifier there, stacked with the pitcher adjustment. Colorado Rockies would get: `30 + 60.6 (20.2% drift) - 15 (bottom team) - 10 (mismatch) = 65.6` instead of 91%.

### 5. Update bot_owner_rules

Insert rule `moneyline_matchup_quality`: "All moneyline Take It Now alerts must factor matchup tightness into confidence. Heavy mismatches require >15% drift. Bottom-tier teams receive confidence penalty."

## Scope
- 1 edge function modified (`fanduel-prediction-alerts`)
- 1 migration (new rule)
- Changes apply to lines 1201-1212 (non-MLB ML), 1142-1200 (MLB ML), and the confidence formula in each branch
- Uses existing `teamStatsMap` data — no new queries


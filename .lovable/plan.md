

## Rewrite Prediction Parlays to Use Perfect Line Scanner Signals

**Problem**: The current `generate-prediction-parlays` pulls from `fanduel_prediction_accuracy` but formats output generically. The user wants parlays built from the exact same "STRONG EDGE" / "PERFECT LINE" signals shown in the Telegram alerts (screenshot), using the same rich format — FanDuel line, matchup stats, hit rate, gap %, action side, and odds.

**Root Cause**: The `perfect-line-scanner` already stores all signal data (opponent, avg_stat, hit_rate, edge_score, floor_gap, odds, team_record, etc.) in the `signal_factors` JSONB column of `fanduel_prediction_accuracy`. The parlay generator ignores this data and formats a bare-bones output.

---

### Plan: Update `generate-prediction-parlays/index.ts`

**1. Source the right signals**
- Query today's `fanduel_prediction_accuracy` where `signal_type` is `PERFECT` or `STRONG` (the same tiers the scanner uses)
- No need for the historical accuracy stats calculation — these are already the highest-quality signals
- Keep the `unified_props` cross-reference for real FanDuel line verification

**2. Extract rich data from `signal_factors`**
- Pull `opponent`, `avg_stat`, `hit_rate`, `games_played`, `min_stat`, `max_stat`, `floor_gap`, `over_price`, `under_price`, `market_type`, `team_record`, `ppg`, `oppg`, `recent_games`, `recency_boost` from the JSONB column
- Use `edge_at_signal` for the edge percentage

**3. Rank and pair**
- Score by: tier (PERFECT > STRONG) × edge × hit_rate
- Same pairing rules: different events, different players, cross-sport priority
- Cap at 3-5 pairs

**4. Format Telegram digest to match the individual alert style**
Each leg formatted like the screenshot:
```
🎯 PERFECT LINE / 🔵 STRONG EDGE
Player Name SIDE Line Prop (+odds)
📗 FanDuel Line: X.X (+odds)
📊 vs Opponent: avg | record | Floor/Ceiling
🔥 Historical: XX% hit rate (X/X games)
✅ Gap: XX.X% above/below line
✅ Action: SIDE Line (+odds)
```

Pair header: `━━━ Pair 1 — Cross-Sport ━━━` with both legs in full detail, then combined edge summary.

**5. Team market support**
- Include spreads, totals, moneyline signals in pairing (different format per the scanner's existing template)
- Allow cross-market pairs (player prop + team market)

### Files Changed
- `supabase/functions/generate-prediction-parlays/index.ts` — full rewrite of data source, ranking, and Telegram formatting


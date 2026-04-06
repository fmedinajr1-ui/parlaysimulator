

# Add Cross-Reference Gate to Behavior Analyzer + Fix Snapback Direction Clarity

## What's Happening

**Your screenshot**: Brandon Woodruff Pitcher Strikeouts, line moved 5.5 → 6.5 (UP), system says UNDER.

**Q1: Was the cross-reference gate used?**
No. The cross-reference gate (L10/L3/matchup validation) only exists in `fanduel-prediction-alerts`. The `fanduel-behavior-analyzer` has the pitcher K badge (display only — shows L10/L3/IP/matchup averages) but does NOT block signals that fail validation. So this alert went out without checking if Woodruff's L10/L3 actually supports UNDER 6.5.

**Q2: Why UNDER when the line is moving UP?**
This is a **snapback** signal — it uses regression-to-mean logic: "line inflated above open → expect it to snap back down." That's conceptually different from the take_it_now/velocity_spike signals we just fixed (where rising = OVER follows market). The snapback is saying the market overreacted — the line moved TOO far up, so it should come back. This logic is defensible BUT only if the player's stats actually support it. Without the cross-reference gate, there's no validation.

## Plan

### 1. Add Cross-Reference Blocking Gate to `fanduel-behavior-analyzer`

Port the same L10/L3/matchup validation logic from `fanduel-prediction-alerts` into the behavior analyzer. After the pitcher K context is loaded (~line 1057) and before building prediction rows (~line 1070):

- For MLB pitcher props: use the already-loaded `pitcherContextMap` (L10, L3, matchup data) to block signals where L10 avg strongly contradicts the action side
- For NBA/NCAAB player props: query `nba_player_game_logs` / `ncaab_player_game_logs` for L10 stats and validate against the action side
- For NHL player props: query `nhl_player_game_logs`

**Blocking rules** (same as prediction-alerts):
- **Hard block**: L10 avg >10% against line AND hit rate <30%
- **Pitcher K gate**: L3 avg >15% against line AND matchup doesn't support
- **Soft block**: L10 AND matchup both fail (<5% edge, <40% hit rate)

Blocked alerts get logged but NOT sent to Telegram.

### 2. Improve Snapback Signal for Pitcher Ks

For snapback signals on pitcher strikeouts specifically:
- If line rose (current > open) and action = UNDER, validate that L10 avg is actually below the current line
- If the pitcher's L10 avg is ABOVE the inflated line, the snapback UNDER is wrong — block it
- Example: If Woodruff averages 7.2 Ks L10 and line went to 6.5, UNDER 6.5 makes no sense even as a snapback

### 3. Add Gate Result to Telegram Display

When a signal passes the gate, append the validation badge to the Telegram message (same format as prediction-alerts):
```
📊 L10 Avg: 5.8 | L3 Avg: 4.7 | L10 Hit: 60% | vs Opp: 5.2 (3g) ⚠️
```

This replaces the current display-only pitcher badge with actionable validation data that also blocks bad signals.

## Scope
- Single file: `supabase/functions/fanduel-behavior-analyzer/index.ts`
- No migration needed
- Reuses existing `pitcherContextMap` for MLB; adds new L10 lookups for NBA/NHL player props


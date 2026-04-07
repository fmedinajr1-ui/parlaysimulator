

# Add Team Correlation Analysis to Take It Now Alerts

## What Changes

Every "Take It Now" alert sent to Telegram will now include a **team correlation scan** — showing how many other players in the same game are moving in the same direction, exactly like the parlay tracker does. This turns each Take It Now pick from a solo line read into a team-validated signal.

## Updated Alert Format

```text
💰 TAKE IT NOW — NHL
Seth Jarvis SHOTS ON GOAL
Open: 2.5 → Now: 3.0 (moved 0.5)
📏 50% of typical range (avg drift: 1.00)
📊 Confidence: 78%

🔗 TEAM CORRELATION: 4/6 players RISING
  Aho: SOG 3.5 → 4.0 (+0.5) ⬆️
  Svechnikov: SOG 2.5 → 3.0 (+0.5) ⬆️
  Kotkaniemi: SOG 1.5 → 1.5 (stable) ➖
📊 80% aligned RISING → CONFIRMED ✅

✅ Action: OVER 3.0 (-152)
💡 Line rising = sharp money on over
```

If correlation is low or opposing, it adds a warning:
```text
🔗 TEAM CORRELATION: 1/5 players RISING
📊 25% aligned → ⚠️ CAUTION — team not confirming
```

## Technical Plan

### File: `supabase/functions/fanduel-prediction-alerts/index.ts`

1. **Add correlation scan function** — reuse the same logic from `parlay-tracker-monitor`:
   - For each Take It Now signal, query `unified_props` for all players in the same `event_id`
   - Filter to same prop category or same team
   - Compare each player's `line` vs `previous_line` to determine direction and magnitude
   - Calculate alignment percentage (% moving in the direction that supports the pick)

2. **Add verdict logic** — same thresholds as parlay tracker:
   - ≥70% aligned + steaming = CONFIRMED ✅
   - ≥40% aligned = PARTIAL ⚠️
   - <40% + fading = TRAP WARNING 🚨

3. **Inject correlation block into alert text** — after the confidence line, before the action line:
   - Show top 3 movers by magnitude
   - Show alignment percentage and verdict
   - Add correlation rate to `signal_factors` in the prediction record for accuracy tracking

4. **Boost/penalize confidence** based on correlation:
   - ≥70% aligned: +5 confidence
   - <30% aligned: -10 confidence (may block marginal signals)

### Scope

| Action | File |
|--------|------|
| Edit | `supabase/functions/fanduel-prediction-alerts/index.ts` |

No new tables or functions needed. This enriches the existing Take It Now pipeline with the same correlation logic already proven in the parlay tracker.


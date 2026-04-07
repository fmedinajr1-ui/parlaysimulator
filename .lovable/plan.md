

# Parlay Line Tracker with Correlation-Style Player Analysis

## What It Does

When you submit 3 legs to Telegram, the bot doesn't just track the odds on those specific lines — it also scans **all other players in the same game** to detect team-wide movement patterns, exactly like the existing correlation/team shift signals do. This gives you a full picture of whether the market is confirming or fading your pick.

## Example Alert (every 15 min, stopping 30 min before tip)

```text
📊 PARLAY TRACKER — 2:15 PM ET

1️⃣ Seth Jarvis SOG O2.5
   Open: -152 → Now: -170 (⬆️ steaming OVER)
   🔗 TEAM CORRELATION: 4/6 CAR players RISING
     Aho: SOG 3.5 → 4.5 (+1.0) ⬆️
     Svechnikov: SOG 2.5 → 3.0 (+0.5) ⬆️
     Kotkaniemi: SOG 1.5 → 1.5 (stable)
   📊 83% aligned RISING → confirms OVER ✅

2️⃣ Garrett Crochet Ks O7.5
   Open: -140 → Now: -130 (⬇️ drifting back)
   🔗 TEAM CORRELATION: 2/4 BOS pitchers DROPPING
     Crochet: Ks 7.5 → 7.5 (stable, odds fading)
     Arroyo: Ks 4.5 → 4.0 (-0.5) ⬇️
   📊 50% mixed → ⚠️ CAUTION

3️⃣ Julius Randle PTS O23.5
   Open: -118 → Now: -125 (⬆️ slight steam)
   🔗 TEAM CORRELATION: 5/7 MIN players RISING
     Randle: PTS 23.5 → 24.5 (+1.0) ⬆️
     Edwards: PTS 28.5 → 29.5 (+1.0) ⬆️
     Gobert: REB 12.5 → 13.0 (+0.5) ⬆️
   📊 71% aligned RISING → supports OVER ✅

Overall: 2/3 legs confirmed by team correlation ✅
```

## Technical Plan

### A. New table: `tracked_parlays`

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | PK |
| chat_id | TEXT | Telegram chat |
| legs | JSONB | `[{player_name, prop_type, side, line, initial_price, sport, event_id, commence_time}]` |
| leg_snapshots | JSONB | Running history of price + team correlation per check |
| status | TEXT | active / completed / expired |
| final_verdict_sent | BOOLEAN | Prevents duplicate final alerts |
| created_at | TIMESTAMPTZ | Submission time |

### B. New edge function: `parlay-tracker-input`

- Parses Telegram message (e.g. "Track: Jarvis SOG O2.5, Crochet Ks O7.5, Randle PTS O23.5")
- Looks up each leg in `unified_props` to get current price, event_id, commence_time, sport
- Inserts into `tracked_parlays`
- Sends confirmation to Telegram

### C. New edge function: `parlay-tracker-monitor` (cron every 15 min)

For each active tracked parlay:

1. **Leg odds check** — query `unified_props` for current price vs initial price → steam/fade
2. **Team correlation scan** — for each leg, query `unified_props` for ALL players in the same `event_id` and same prop category:
   - Compare each player's current line vs their opening line
   - Calculate direction (rising/dropping) and magnitude for each
   - Compute correlation rate (% of players moving same direction)
   - Build `players_moving` array identical to the behavior analyzer format
3. **Verdict per leg**:
   - Steam + high correlation (≥70% aligned) = ✅ CONFIRMED
   - Steam + low correlation = ⚠️ PARTIAL
   - Fade + high opposite correlation = 🚨 TRAP WARNING
   - Stable = ➖ NEUTRAL
4. **Overall parlay health** = count of confirmed legs
5. **30-min final verdict** — sends lock-in or bail recommendation

### D. Telegram alert format

Uses the same player-by-player breakdown as correlation signals:
- Each player listed with `name: direction magnitude`
- Correlation rate shown as `X% aligned RISING/DROPPING`
- Action recommendation per leg and overall

## Scope

| Action | File |
|--------|------|
| Migration | Create `tracked_parlays` table |
| Create | `supabase/functions/parlay-tracker-input/index.ts` |
| Create | `supabase/functions/parlay-tracker-monitor/index.ts` |
| Cron | 15-min schedule for monitor |


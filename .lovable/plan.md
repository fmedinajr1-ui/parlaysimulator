

## Line Adjustment Recovery System — "Scale-In Staking"

### Problem
You bet SGA PRA at 38.5 and lost. FanDuel often adjusts lines after the initial posting — the line might move to 37.5 or 36.5 later. The system currently doesn't track whether you already bet a market, so it can't tell you to wait, scale in, or recover.

### Solution: Two-Phase "Scale-In" Alert System

**Phase 1 — Initial Alert = Small Stake Warning**
When a Perfect Line or Strong Edge fires for a combo prop (PRA, PR, PA, etc.), the alert tells you to bet only **25% of your normal unit** because the line may adjust. The message says:

```
🎯 PERFECT LINE: Shai Gilgeous-Alexander OVER 38.5 PRA (-115)
📊 vs OPP: 42.1 avg | 4/5 over | Floor: 39
⚠️ SCALE-IN: Bet 25% unit ($5). Line may adjust — hold reserves.
```

**Phase 2 — Line Adjustment = Double Down Alert**
The system watches `fanduel_line_timeline` for the same player+prop. If the line drops (e.g., 38.5 → 37.5), it fires a **recovery alert** with a larger stake:

```
🔄 LINE ADJUSTED: SGA PRA dropped 38.5 → 37.5 (-110)
📊 Edge improved: 42.1 avg vs 37.5 line (+12.3% edge)
💰 SCALE UP: Bet 50% unit ($10). Better entry point.
🛡️ If it drops again → full unit.
```

If it drops a second time (37.5 → 36.5), full unit fires:
```
🔥 PERFECT ENTRY: SGA PRA now 36.5 — max value reached
💰 FULL UNIT: Bet remaining 25% ($5). Total invested: $20 across 3 entries.
📊 Avg entry: 37.5 | Current edge: +15.3%
```

### How It Works Technically

**1. New table: `scale_in_tracker`**
Tracks active scale-in positions per user/day:
- `player_name`, `prop_type`, `event_id`, `initial_line`, `current_line`, `entries` (JSON array of lines bet), `phase` (1/2/3), `created_at`

**2. Update `perfect-line-scanner`**
- On first detection of a combo prop signal → insert into `scale_in_tracker` with phase=1, mark alert as "scale-in"
- On subsequent runs, check if any tracked lines have moved → if line dropped, fire phase 2/3 alerts
- Cross-reference: before outputting ANY combo prop alert, check if a previous entry exists — if so, output a recovery/scale-up alert instead of a duplicate recommendation

**3. Update `fanduel-prediction-alerts`**
- New signal types: `scale_in_initial`, `scale_in_adjust`, `scale_in_max`
- Format with staking guidance (25% → 50% → 25% remaining)
- Include average entry price across all phases

**4. Staking tiers based on line movement:**

| Phase | Trigger | Stake | Cumulative |
|-------|---------|-------|------------|
| 1 | Initial detection | 25% unit | 25% |
| 2 | Line drops ≥ 0.5 | 50% unit | 75% |
| 3 | Line drops ≥ 1.0 total | 25% unit | 100% |

If the line moves AGAINST you (goes up), the system sends a "hold — no additional entry" message.

### Files to Create/Edit

| File | Action |
|------|--------|
| DB migration | Create `scale_in_tracker` table |
| `supabase/functions/perfect-line-scanner/index.ts` | Add scale-in detection logic for combo props, check for line adjustments on tracked positions |
| `supabase/functions/fanduel-prediction-alerts/index.ts` | Add `scale_in_*` signal formatting with staking guidance |

### Key Benefit
Instead of going all-in on the first line and losing, you deploy capital progressively as the line adjusts in your favor — dollar-cost averaging into the best entry point. If the initial line hits, you still profit (just smaller). If it adjusts, you get a better average entry and recover the initial loss.


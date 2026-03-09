

## Plan: Daily Parlay Cap (25), Player Exposure Cap (1, max 2 for double-confirmed)

### Problem
The system generates far too many parlays per day (39+ on March 8th), and players appear across too many parlays. The user wants:
1. **Hard cap of 25 parlays per day** total
2. **Player appears max 1 time** across all parlays (not per-tier — globally)
3. **Exception: max 2 times** if the player-prop is double-confirmed

### Changes

#### 1. Daily Parlay Cap (25) — `bot-generate-daily-parlays`
In the main generation loop (~line 9683), after pre-loading existing pending parlays, count how many are already pending. If already at 25, skip generation entirely. During generation, track running total and stop producing parlays once the cumulative count (existing + new) hits 25.

Also reduce tier `count` values:
- Exploration: 150 → 15
- Validation: 50 → 10  
- Execution: 40 → 8

These are max-attempt counts; the hard cap of 25 total is the real limiter.

#### 2. Player Exposure Cap (1 global, 2 for double-confirmed) — `bot-generate-daily-parlays`
Change `HARD_CAP_PLAYER_PROP = 3` at line 3387 to a dynamic cap:
- Default: `1` (player can only appear in 1 parlay)
- If the pick's strategy/source is `double_confirmed` or `triple_confirmed`: cap is `2`

Update the check at lines 3384-3391 to use player name only (not player+prop), and look up whether the pick is double-confirmed to decide the cap.

#### 3. Quality Regen Exposure Cap — `bot-quality-regen-loop`
Update `EXPOSURE_CAP = 3` at line 262 to `1` (with double-confirmed exception of `2`). The regen loop already has the exposure dedup pass — just tighten the cap.

#### 4. Diversity Rebalance Alignment — `bot-daily-diversity-rebalance`
Update `maxPlayerPropUsage` default from `3` to `1` to match the new global cap. The rebalance function is the final safety net.

#### 5. Daily Cap in Quality Regen Loop — `bot-quality-regen-loop`
After the exposure dedup pass, add a daily cap pass: if more than 25 parlays remain pending, void the lowest-probability excess (keep top 25 by `combined_probability`).

### Files to Edit

| File | Change |
|------|--------|
| `bot-generate-daily-parlays/index.ts` | Reduce tier counts, add 25-parlay running cap, change player cap from 3 to 1 (2 for double-confirmed) |
| `bot-quality-regen-loop/index.ts` | Change EXPOSURE_CAP from 3 to 1 (2 for double-confirmed), add 25-parlay cap pass |
| `bot-daily-diversity-rebalance/index.ts` | Change default `maxPlayerPropUsage` from 3 to 1 |


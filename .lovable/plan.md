
# Save Today's Elite 3PT & Assist Picks for Automated Outcome Tracking

## Overview
This plan updates the existing `category_sweet_spots` records for January 31st to activate elite 3PT and assist picks with live sportsbook lines, enabling automated outcome verification by the `verify-sweet-spot-outcomes` edge function.

## Current State Analysis

### Database Status (Jan 31)
| Prop Type | Total Records | Active | Issue |
|-----------|---------------|--------|-------|
| 3PT (threes) | 57 | 0 | All inactive, no live lines |
| Assists | 30 | 0 | All inactive, no live lines |

### Elite Candidates Identified
**3PT Shooters (10 picks with games today):**
- Jaden McDaniels (O 1.5, L10: 100%, L5 Edge: +1.7, HOT)
- Klay Thompson (O 2.5, L10: 100%, STABLE)
- Pascal Siakam (O 1.5, L10: 100%, STABLE)
- Saddiq Bey (O 1.5, L10: 100%, L5 Edge: +1.3)
- Coby White (O 2.5, L10: 100%)
- Donte DiVincenzo (O 3.5, L10: 100%)
- Anthony Edwards (O 3.5, L10: 100%)
- Nickeil Alexander-Walker (O 2.5/3.5, L10: 100%)

**Assist Props (2 elite picks with games today):**
- Alperen Sengun (O 5.5, L10: 100%, L10 Avg: 6.2)
- Paul George (O 4.5, L10: 90%, L10 Avg: 4.4)

---

## Implementation Steps

### Step 1: Activate 3PT Elite Picks
Update records to set:
- `is_active = true` (enables outcome verification)
- `actual_line` = live sportsbook line from `unified_props`
- `outcome = 'pending'` (required for verification loop)
- `recommended_side = 'OVER'` (for hit/miss calculation)
- `quality_tier` based on L5 momentum (HOT/STABLE/ELITE)

**Players to activate:** Jaden McDaniels, Klay Thompson, Pascal Siakam, Saddiq Bey, Coby White, Donte DiVincenzo, Anthony Edwards, Nickeil Alexander-Walker, Matas Buzelis, Isaac Okoro, Bam Adebayo

### Step 2: Activate Assist Elite Picks
Same update pattern for assist picks:
- Alperen Sengun: O 5.5 (L10 Avg: 6.2, +0.7 edge)
- Paul George: O 4.5 (L10 Avg: 4.4, -0.1 edge, but 90% L10)

### Step 3: Add L5 Momentum Flags
Enrich picks with new candidates from the live L5 analysis:
- Trey Murphy III (Assists O 3.5, L5: 6.0, HOT)
- Aaron Nesmith (Assists O 2.5, L5: 4.4, HOT)
- Herb Jones (Assists O 2.5, ultra-low variance 0.65)
- Tari Eason (3PT O 1.5, L5: 3.0, HOT)

---

## Technical Details

### SQL Updates Required

**Activate 3PT picks:**
```sql
UPDATE category_sweet_spots 
SET 
  is_active = true,
  outcome = 'pending',
  recommended_side = 'OVER',
  actual_line = (SELECT current_line FROM unified_props WHERE prop_type = 'threes' 
                 AND LOWER(player_name) = LOWER(css.player_name) LIMIT 1),
  quality_tier = 'ELITE'
WHERE analysis_date = '2026-01-31'
  AND prop_type = 'threes'
  AND l10_hit_rate >= 0.90
  AND player_name IN (SELECT DISTINCT player_name FROM unified_props 
                      WHERE prop_type = 'threes' 
                      AND commence_time >= '2026-02-01T00:00:00'
                      AND commence_time < '2026-02-01T12:00:00');
```

**Activate assist picks:**
```sql
UPDATE category_sweet_spots 
SET 
  is_active = true,
  outcome = 'pending',
  recommended_side = 'OVER',
  actual_line = (SELECT current_line FROM unified_props WHERE prop_type = 'assists' 
                 AND LOWER(player_name) = LOWER(css.player_name) LIMIT 1),
  quality_tier = 'ELITE'
WHERE analysis_date = '2026-01-31'
  AND prop_type = 'assists'
  AND l10_hit_rate >= 0.85
  AND player_name IN (SELECT DISTINCT player_name FROM unified_props 
                      WHERE prop_type = 'assists' 
                      AND commence_time >= '2026-02-01T00:00:00'
                      AND commence_time < '2026-02-01T12:00:00');
```

### Verification Integration
The existing `verify-sweet-spot-outcomes` edge function will automatically:
1. Query picks where `is_active = true` and `outcome = 'pending'`
2. Match against `nba_player_game_logs` using `game_date = analysis_date`
3. Compare `actual_value` vs `actual_line` with `recommended_side`
4. Update `outcome` to 'hit', 'miss', or 'push'
5. Log results to `cron_job_history`

---

## Expected Outcome

After activation:
| Metric | 3PT | Assists | Total |
|--------|-----|---------|-------|
| Active picks | ~11 | ~4 | ~15 |
| Avg L10 Hit Rate | 98%+ | 93%+ | 96%+ |
| Quality Tier | ELITE | ELITE | - |

Tomorrow morning (6 AM ET), the cron job will automatically settle these picks and record accuracy metrics.

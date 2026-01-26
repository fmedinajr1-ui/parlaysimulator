

## Lock Mode Backtest Feature

### Overview
Build a backtest system that simulates the 4-gate Lock Mode filtering against historical data to validate the expected 42%+ parlay win rate. This uses the existing `scout_prop_outcomes` table (which has prediction data including `rotation_role`, `minutes_uncertainty`, `risk_flags`) combined with `player_archetypes` for archetype/role information.

---

### Architecture

```text
+-------------------------------------------------------------------------+
|                     Lock Mode Backtester                                |
+-------------------------------------------------------------------------+
|                                                                         |
|  Data Sources:                                                          |
|  +---------------------------+  +-----------------------------+        |
|  | scout_prop_outcomes       |  | player_archetypes           |        |
|  | - predicted_final         |  | - primary_archetype         |        |
|  | - actual_final            |  | - avg_minutes               |        |
|  | - outcome (hit/miss/push) |  | - player_name               |        |
|  | - rotation_role           |  +-----------------------------+        |
|  | - minutes_uncertainty     |                                         |
|  | - risk_flags              |         +-------------------------+     |
|  | - line, side, prop        |         | category_sweet_spots    |     |
|  +---------------------------+         | - l10_std_dev           |     |
|                                        | - confidence_score      |     |
|            |                           | - l10_hit_rate          |     |
|            v                           +-------------------------+     |
|  +-----------------------------------------------+                     |
|  |        Lock Mode Gate Simulation              |                     |
|  |  Gate 1: Minutes & Rotation Check             |                     |
|  |  Gate 2: Stat Type Priority (REB > AST > PTS) |                     |
|  |  Gate 3: Edge >= Uncertainty x 1.25           |                     |
|  |  Gate 4: Strict UNDER Rules                   |                     |
|  |  Confidence Filter: >= 72%                    |                     |
|  +-----------------------------------------------+                     |
|            |                                                           |
|            v                                                           |
|  +-----------------------------------------------+                     |
|  |        3-Leg Slot Builder                     |                     |
|  |  Slot 1: BIG_REB_OVER                         |                     |
|  |  Slot 2: ASSIST_OVER                          |                     |
|  |  Slot 3: FLEX (PTS/PRA/UNDER)                 |                     |
|  +-----------------------------------------------+                     |
|            |                                                           |
|            v                                                           |
|  +-----------------------------------------------+                     |
|  |        Outcome Grading                        |                     |
|  |  - All 3 legs hit = PARLAY WIN                |                     |
|  |  - Track leg hit rate, parlay win rate        |                     |
|  |  - Record blocking effectiveness              |                     |
|  +-----------------------------------------------+                     |
|                                                                         |
+-------------------------------------------------------------------------+
```

---

### Database Changes

**New Table: `lock_mode_backtest_runs`**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| run_name | TEXT | Descriptive name |
| date_range_start | DATE | Start of backtest period |
| date_range_end | DATE | End of backtest period |
| config | JSONB | Gate thresholds used |
| total_slates | INT | Number of game days processed |
| slips_generated | INT | Number of valid 3-leg slips |
| slips_passed | INT | Days with 0 valid slips (intentional pass) |
| total_legs | INT | Total legs in valid slips |
| legs_hit | INT | Legs that hit |
| legs_missed | INT | Legs that missed |
| legs_pushed | INT | Legs that pushed |
| leg_hit_rate | NUMERIC | legs_hit / (legs_hit + legs_missed) |
| parlay_win_rate | NUMERIC | 3-leg slips where all hit |
| gate_block_stats | JSONB | Breakdown by gate (minutes, stat_type, edge, under) |
| avg_edge_value | NUMERIC | Average edge of selected legs |
| created_at | TIMESTAMPTZ | Timestamp |
| completed_at | TIMESTAMPTZ | Completion time |

**New Table: `lock_mode_backtest_slips`**

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| run_id | UUID | FK to lock_mode_backtest_runs |
| slate_date | DATE | Game date |
| slip_valid | BOOLEAN | True if all 3 slots filled |
| legs | JSONB | Array of leg details with outcomes |
| leg_count | INT | Should be 3 or 0 |
| legs_hit | INT | 0-3 |
| legs_missed | INT | 0-3 |
| all_legs_hit | BOOLEAN | Parlay win indicator |
| missing_slots | TEXT[] | Which slots couldn't be filled |
| blocked_candidates | JSONB | Candidates that failed gates |

---

### Edge Function: `run-lock-mode-backtest`

**Purpose:** Execute the Lock Mode 4-gate simulation against historical data.

**Input:**
```json
{
  "dateStart": "2026-01-01",
  "dateEnd": "2026-01-26"
}
```

**Logic Flow:**

1. **Fetch Historical Data**
   - Query `scout_prop_outcomes` for settled predictions in date range
   - Join with `player_archetypes` for archetype/role info
   - Optionally enrich with `category_sweet_spots` for L10 variance data

2. **Group by Game Date**
   - Each date represents a potential "halftime slate"

3. **Simulate Lock Mode Gates for Each Date**
   - For each pick on that date:
     - **Gate 1 (Minutes):** Check `rotation_role` in (STARTER, CLOSER), simulate stable minutes from `avg_minutes`
     - **Gate 2 (Stat Type):** Only Rebounds, Assists, PRA, Points allowed
     - **Gate 3 (Edge vs Uncertainty):** `|predicted_final - line| >= minutes_uncertainty * 1.25`
     - **Gate 4 (UNDER Rules):** If side=UNDER, require low variance and no BREAKOUT_RISK/BLOWOUT_RISK flags
     - **Confidence Filter:** `confidence_raw >= 72`

4. **Fill 3 Slots**
   - Slot 1: BIG_REB_OVER (Rebounds OVER with BIG/PRIMARY archetype)
   - Slot 2: ASSIST_OVER (Assists OVER with PRIMARY/SECONDARY role)
   - Slot 3: FLEX (Points OVER for stars, PRA for bigs, or fatigue UNDER)

5. **Grade Outcomes**
   - Check actual `outcome` field for each selected leg
   - Track individual leg hit rate and parlay (all 3 hit) win rate

6. **Store Results**
   - Insert run summary to `lock_mode_backtest_runs`
   - Insert per-date slips to `lock_mode_backtest_slips`

**Output:**
```json
{
  "success": true,
  "runId": "uuid",
  "summary": {
    "dateRange": { "start": "2026-01-01", "end": "2026-01-26" },
    "totalSlates": 26,
    "slipsGenerated": 18,
    "slipsPassed": 8,
    "totalLegs": 54,
    "legsHit": 42,
    "legsMissed": 12,
    "legHitRate": 77.78,
    "parlayWinRate": 44.44,
    "gateBlockStats": {
      "minutes": 34,
      "statType": 89,
      "edge": 156,
      "under": 23,
      "confidence": 67
    }
  }
}
```

---

### UI Component: `LockModeBacktestDashboard`

**Location:** `src/components/scout/LockModeBacktestDashboard.tsx`

**Features:**
- Date range picker (start/end)
- "Run Backtest" button
- Results display:
  - **Headline Stats Card:** Leg Hit Rate, Parlay Win Rate, Slips Generated vs Passed
  - **Gate Effectiveness Chart:** Bar chart showing how many picks blocked per gate
  - **Daily Results Table:** Date, Slip Valid?, Legs, Outcome (Win/Loss/Pass)
  - **Win Rate Trend Line:** Chart showing cumulative parlay win rate over time

**Example UI Layout:**
```text
+----------------------------------------------------------+
| LOCK MODE BACKTESTER                                      |
| "Simulate 4-Gate Filtering on Historical Data"           |
+----------------------------------------------------------+
| Date Range: [2026-01-01] to [2026-01-26]  [Run Backtest] |
+----------------------------------------------------------+
|                                                          |
| +----------------+  +----------------+  +----------------+|
| | LEG HIT RATE   |  | PARLAY WIN RATE|  | SLIPS GENERATED||
| |    77.8%       |  |    44.4%       |  |   18 / 26     ||
| |  (Target: 75%) |  |  (Target: 42%) |  |  (8 passed)   ||
| +----------------+  +----------------+  +----------------+|
|                                                          |
| GATE BLOCKING EFFECTIVENESS                              |
| +------------------------------------------------------+|
| | [====] Minutes Gate:    34 blocked                   ||
| | [========] Stat Type:   89 blocked                   ||
| | [================] Edge vs Unc: 156 blocked          ||
| | [===] UNDER Rules:      23 blocked                   ||
| | [=======] Confidence:   67 blocked                   ||
| +------------------------------------------------------+|
|                                                          |
| DAILY RESULTS                                            |
| +------------------------------------------------------+|
| | Date       | Valid | Legs          | Outcome         ||
| |------------|-------|---------------|-----------------|  |
| | 2026-01-26 | Yes   | 3/3 hit       | WIN             ||
| | 2026-01-25 | Yes   | 2/3 hit       | LOSS            ||
| | 2026-01-24 | No    | — (no slip)   | PASS            ||
| +------------------------------------------------------+|
+----------------------------------------------------------+
```

---

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/xxx_lock_mode_backtest_tables.sql` | Create | New tables for backtest results |
| `supabase/functions/run-lock-mode-backtest/index.ts` | Create | Edge function with 4-gate simulation |
| `supabase/config.toml` | Modify | Add new function config |
| `src/components/scout/LockModeBacktestDashboard.tsx` | Create | UI for running/viewing backtests |
| `src/hooks/useLockModeBacktest.ts` | Create | Hook for invoking backtest and fetching results |

---

### Key Implementation Details

**Mapping Historical Data to Lock Mode Gates:**

| Gate | Historical Data Source | Simulation Logic |
|------|------------------------|------------------|
| Gate 1: Minutes | `scout_prop_outcomes.rotation_role` + `player_archetypes.avg_minutes` | role in (STARTER, CLOSER), avg_minutes >= 28 |
| Gate 2: Stat Type | `scout_prop_outcomes.prop` | prop in (Rebounds, Assists, PRA, Points) |
| Gate 3: Edge | `scout_prop_outcomes.predicted_final`, `line`, `minutes_uncertainty` | abs(predicted - line) >= uncertainty * 1.25 |
| Gate 4: UNDER | `scout_prop_outcomes.risk_flags`, `side` | If UNDER: no BREAKOUT_RISK, no BLOWOUT_RISK |
| Confidence | `scout_prop_outcomes.confidence_raw` | confidence >= 72 |

**Archetype to Role Mapping:**
```javascript
const archetypeToRole = {
  'ELITE_REBOUNDER': 'BIG',
  'GLASS_CLEANER': 'BIG',
  'RIM_PROTECTOR': 'BIG',
  'STRETCH_BIG': 'BIG',
  'PLAYMAKER': 'PRIMARY',
  'COMBO_GUARD': 'PRIMARY',
  'SCORING_GUARD': 'PRIMARY',
  'THREE_AND_D': 'SECONDARY',
  'ROLE_PLAYER': 'SECONDARY'
};
```

---

### Expected Results

Based on the Lock Mode design with 75% individual leg confidence:
- **Target Leg Hit Rate:** 75%+
- **Target 3-Leg Parlay Win Rate:** 42%+ (0.75^3 = 0.42)
- **Pass Days:** 20-40% of slates (when gates can't fill all 3 slots)

The backtest validates whether the 4-gate filtering actually achieves these theoretical targets against real historical data.

---

### Summary

This feature provides empirical validation of the Lock Mode system by:
1. Replaying historical predictions through the 4-gate filter
2. Measuring actual leg hit rate and parlay win rate
3. Quantifying how many bad picks each gate blocked
4. Identifying which slot types are hardest to fill
5. Proving the "pass is a win" philosophy with slip generation rates


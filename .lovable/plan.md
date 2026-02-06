

# Hedge Status Accuracy Tracker

## How Hit Probability Is Calculated (Current System)

The hedge recommendation system uses a multi-factor calculation to determine status. Here's exactly how it works:

### 1. Base Probability Calculation (Lines 55-107)

```text
For OVER bets:
┌────────────────────────────────────────────────────────────────┐
│ 1. Calculate buffer = projectedFinal - line                    │
│                                                                 │
│    projected = current + (ratePerMinute × remainingMinutes)    │
│    buffer = projected - line                                    │
│                                                                 │
│ 2. Map buffer to probability:                                   │
│    buffer ≥ +3.0  →  85% base probability                      │
│    buffer ≥ +1.0  →  70% base probability                      │
│    buffer ≥  0.0  →  55% base probability                      │
│    buffer ≥ -1.0  →  40% base probability                      │
│    buffer ≥ -2.0  →  25% base probability                      │
│    buffer <  -2.0 →  15% base probability                      │
└────────────────────────────────────────────────────────────────┘
```

### 2. Zone Matchup Modifier (±15% max)

```text
If player has shot chart analysis:
  zoneModifier = clamp(matchupScore × 3, -15, +15)
  
  OVER: hitProbability += zoneModifier
        (Good matchup = higher probability)
        
  UNDER: hitProbability -= zoneModifier
         (Good matchup for player = LOWER under probability)
```

### 3. Rotation-Aware Adjustments

The system uses `rotation-patterns.ts` to estimate remaining play minutes by tier:

| Player Tier | Standard Minutes | Rest Impact |
|-------------|------------------|-------------|
| Star        | 36-38 min/game   | Closer bonus in tight games |
| Starter     | 28-32 min/game   | Standard rotations |
| Role Player | 18-24 min/game   | Blowout penalty |

### 4. Status Thresholds (Dynamically Adjusted)

```text
Default Thresholds:
┌─────────────────────────────────────────────────────┐
│ Status    │ Hit Probability Threshold              │
├───────────┼────────────────────────────────────────┤
│ ON_TRACK  │ ≥ 65%                                  │
│ MONITOR   │ 45-65%                                 │
│ ALERT     │ 25-45%                                 │
│ URGENT    │ < 25%                                  │
└───────────┴────────────────────────────────────────┘

Threshold Adjustments Applied:
- Player benched (rest window): +15% to all thresholds
- Approaching rest: +8% to all thresholds
- Zone advantage: -10% (more patient)
- Zone disadvantage: +10% (more aggressive hedge)
```

### 5. Risk Factor Overrides

These force higher urgency regardless of probability:
- **Blowout detected** (gameProgress > 60%) → URGENT
- **Multiple risk flags** (foul trouble + blowout) → URGENT
- **Slow pace** (paceRating < 95 for OVER) → ALERT

---

## What We Need: Hedge Status Accuracy Tracker

### Current Gap

The system calculates statuses in real-time but **does not record them**. When a pick settles (hit/miss), we don't know what status it had at Q1, halftime, Q3, or late Q4.

**Questions we cannot answer today:**
- What % of "On Track" picks at halftime actually hit?
- What % of "Alert" picks at Q3 ended up missing?
- Should "Urgent" trigger earlier or later?

### Solution: Sweet Spot Hedge Snapshots Table

Create a dedicated table that links Sweet Spot picks to their hedge status at each quarter boundary:

---

## Database Schema

### New Table: `sweet_spot_hedge_snapshots`

```sql
CREATE TABLE public.sweet_spot_hedge_snapshots (
  id BIGSERIAL PRIMARY KEY,
  
  -- Link to Sweet Spot pick
  sweet_spot_id UUID REFERENCES category_sweet_spots(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  line NUMERIC NOT NULL,
  side TEXT NOT NULL,  -- 'over' or 'under'
  
  -- Snapshot timing
  quarter INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  game_progress NUMERIC NOT NULL,  -- 0-100
  
  -- Hedge status at this moment
  hedge_status TEXT NOT NULL,  -- 'on_track', 'monitor', 'alert', 'urgent', 'profit_lock'
  hit_probability INTEGER NOT NULL,  -- 0-100
  
  -- Production data
  current_value NUMERIC NOT NULL,
  projected_final NUMERIC NOT NULL,
  rate_per_minute NUMERIC,
  rate_needed NUMERIC,
  gap_to_line NUMERIC,
  
  -- Context factors
  pace_rating NUMERIC,
  zone_matchup_score NUMERIC,
  rotation_tier TEXT,  -- 'star', 'starter', 'role_player'
  risk_flags TEXT[],
  
  -- Live line tracking
  live_book_line NUMERIC,
  line_movement NUMERIC,
  
  -- Timestamps
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Ensure one snapshot per pick per quarter
  CONSTRAINT unique_spot_quarter UNIQUE (sweet_spot_id, quarter)
);

-- Indexes for analytics
CREATE INDEX idx_hedge_snapshots_status ON sweet_spot_hedge_snapshots (hedge_status, quarter);
CREATE INDEX idx_hedge_snapshots_outcome ON sweet_spot_hedge_snapshots (sweet_spot_id);
```

---

## Recording Hook: `useHedgeStatusRecorder`

Create a client-side hook that records hedge status at quarter boundaries:

```typescript
// src/hooks/useHedgeStatusRecorder.ts

export function useHedgeStatusRecorder(spots: DeepSweetSpot[]) {
  const recordedQuarters = useRef<Map<string, Set<number>>>(new Map());
  
  useEffect(() => {
    // For each live spot, check if we should record
    spots.forEach(spot => {
      if (!spot.liveData?.isLive) return;
      
      const currentQ = spot.liveData.currentQuarter;
      const progress = spot.liveData.gameProgress;
      
      // Record at quarter boundaries (24%, 49%, 74%, 95%+)
      const shouldRecord = (
        (currentQ === 1 && progress >= 24 && progress < 30) ||
        (currentQ === 2 && progress >= 49 && progress < 55) ||
        (currentQ === 3 && progress >= 74 && progress < 80) ||
        (currentQ === 4 && progress >= 95)
      );
      
      if (shouldRecord && !alreadyRecorded(spot.id, currentQ)) {
        recordHedgeSnapshot(spot);
        markRecorded(spot.id, currentQ);
      }
    });
  }, [spots]);
}
```

---

## Analytics Functions

### 1. Hit Rate by Hedge Status at Each Quarter

```sql
CREATE OR REPLACE FUNCTION get_hedge_status_accuracy(days_back INTEGER DEFAULT 30)
RETURNS TABLE (
  quarter INTEGER,
  hedge_status TEXT,
  total_picks BIGINT,
  hits BIGINT,
  misses BIGINT,
  hit_rate NUMERIC,
  avg_hit_probability NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    hs.quarter,
    hs.hedge_status,
    COUNT(*) as total_picks,
    COUNT(*) FILTER (WHERE css.outcome = 'hit') as hits,
    COUNT(*) FILTER (WHERE css.outcome = 'miss') as misses,
    ROUND(
      COUNT(*) FILTER (WHERE css.outcome = 'hit')::NUMERIC / 
      NULLIF(COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')), 0) * 100, 
      1
    ) as hit_rate,
    ROUND(AVG(hs.hit_probability), 1) as avg_hit_probability
  FROM sweet_spot_hedge_snapshots hs
  JOIN category_sweet_spots css ON hs.sweet_spot_id = css.id
  WHERE css.analysis_date >= current_date - days_back
    AND css.outcome IN ('hit', 'miss')
  GROUP BY hs.quarter, hs.hedge_status
  ORDER BY hs.quarter, 
    CASE hs.hedge_status 
      WHEN 'on_track' THEN 1
      WHEN 'monitor' THEN 2
      WHEN 'alert' THEN 3
      WHEN 'urgent' THEN 4
    END;
END;
$$ LANGUAGE plpgsql;
```

### 2. Calibration Check (Probability vs Reality)

```sql
CREATE OR REPLACE FUNCTION get_hedge_probability_calibration(days_back INTEGER DEFAULT 30)
RETURNS TABLE (
  probability_bucket TEXT,
  quarter INTEGER,
  total_picks BIGINT,
  hits BIGINT,
  actual_hit_rate NUMERIC,
  expected_hit_rate NUMERIC,
  calibration_error NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN hs.hit_probability >= 80 THEN '80-100%'
      WHEN hs.hit_probability >= 60 THEN '60-80%'
      WHEN hs.hit_probability >= 40 THEN '40-60%'
      WHEN hs.hit_probability >= 20 THEN '20-40%'
      ELSE '0-20%'
    END as probability_bucket,
    hs.quarter,
    COUNT(*) as total_picks,
    COUNT(*) FILTER (WHERE css.outcome = 'hit') as hits,
    ROUND(
      COUNT(*) FILTER (WHERE css.outcome = 'hit')::NUMERIC / 
      NULLIF(COUNT(*), 0) * 100, 
      1
    ) as actual_hit_rate,
    ROUND(AVG(hs.hit_probability), 1) as expected_hit_rate,
    ROUND(
      ABS(
        COUNT(*) FILTER (WHERE css.outcome = 'hit')::NUMERIC / NULLIF(COUNT(*), 0) * 100 - 
        AVG(hs.hit_probability)
      ), 
      1
    ) as calibration_error
  FROM sweet_spot_hedge_snapshots hs
  JOIN category_sweet_spots css ON hs.sweet_spot_id = css.id
  WHERE css.analysis_date >= current_date - days_back
    AND css.outcome IN ('hit', 'miss')
  GROUP BY 
    CASE 
      WHEN hs.hit_probability >= 80 THEN '80-100%'
      WHEN hs.hit_probability >= 60 THEN '60-80%'
      WHEN hs.hit_probability >= 40 THEN '40-60%'
      WHEN hs.hit_probability >= 20 THEN '20-40%'
      ELSE '0-20%'
    END,
    hs.quarter
  ORDER BY quarter, probability_bucket DESC;
END;
$$ LANGUAGE plpgsql;
```

---

## Dashboard Component

Add a new analytics section showing hedge status accuracy:

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 📊 Hedge Status Accuracy (Last 30 Days)                                │
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  At Halftime (Q2)                                                       │
│  ┌─────────────┬─────────┬─────────┬──────────────┐                    │
│  │ Status      │ Picks   │ Hits    │ Hit Rate     │                    │
│  ├─────────────┼─────────┼─────────┼──────────────┤                    │
│  │ ✓ On Track  │ 142     │ 118     │ 83.1%        │ ← Most reliable   │
│  │ ⚡ Monitor   │ 89      │ 52      │ 58.4%        │                    │
│  │ ⚠️ Alert    │ 67      │ 28      │ 41.8%        │                    │
│  │ 🚨 Urgent   │ 34      │ 9       │ 26.5%        │                    │
│  └─────────────┴─────────┴─────────┴──────────────┘                    │
│                                                                         │
│  At Q3 End                                                              │
│  ┌─────────────┬─────────┬─────────┬──────────────┐                    │
│  │ ✓ On Track  │ 156     │ 141     │ 90.4%        │ ← Very reliable   │
│  │ ⚡ Monitor   │ 72      │ 49      │ 68.1%        │                    │
│  │ ⚠️ Alert    │ 45      │ 22      │ 48.9%        │                    │
│  │ 🚨 Urgent   │ 28      │ 6       │ 21.4%        │                    │
│  └─────────────┴─────────┴─────────┴──────────────┘                    │
│                                                                         │
│  💡 Insight: "On Track" at Q3 has 90%+ accuracy - high confidence     │
│              "Alert" at halftime still hits 41% - don't panic          │
│                                                                         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Files

| File | Purpose |
|------|---------|
| `supabase/migrations/xxx_create_hedge_snapshots.sql` | Create table and indexes |
| `supabase/functions/record-hedge-snapshot/index.ts` | Edge function to record snapshots |
| `src/hooks/useHedgeStatusRecorder.ts` | Client-side quarter boundary detection |
| `src/hooks/useSweetSpotLiveData.ts` | Integrate recorder into live data flow |
| `supabase/migrations/xxx_hedge_accuracy_functions.sql` | Analytics RPCs |
| `src/components/sweetspots/HedgeStatusAccuracyCard.tsx` | Dashboard visualization |

---

## Expected Insights

After collecting data for 1-2 weeks, we'll be able to answer:

1. **"Which status is most predictive?"**
   - On Track at halftime: ~80-85% hit rate
   - Alert at Q3: ~45-50% hit rate

2. **"Should I panic if I see Alert at halftime?"**
   - If Alert at Q2 still hits 40-45%, recommendation: "Watch closely, don't hedge yet"

3. **"When should I definitely hedge?"**
   - If Urgent at Q3 only hits 15-20%, recommendation: "Hedge immediately at Q3 Urgent"

4. **"Is our probability calibrated?"**
   - If we say 70% and actual is 65%, that's well-calibrated
   - If we say 70% and actual is 50%, we're overconfident → adjust thresholds


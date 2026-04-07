

# Boost Correlated & Team Shift Signal Volume + Show Yesterday's Results

## Current State

| Signal | Last 7d Volume | Hit Rate | Status |
|--------|---------------|----------|--------|
| take_it_now | 120 alerts | 72.7% | Working well |
| snapback | 28 alerts | 22.7% | Terrible |  
| team_news_shift | 8 alerts | N/A | Never settled |
| correlated_movement | 3 alerts | N/A | Never settled |

Correlation signals are extremely rare because thresholds are strict:
- Requires 3+ players shifting same direction
- Requires 0.5+ point movement from opening line
- Requires 70%+ directional alignment

**Parlay generator**: Last run was December 2025 — no yesterday data exists.

## Changes

### 1. Lower Correlation Detection Thresholds (behavior-analyzer)

Current → New:
- **Minimum players**: 3 → **2** (pairs of players shifting together are still meaningful)
- **Minimum movement**: 0.5 → **0.3** points from open (captures earlier signals)
- **Correlation rate**: 0.7 → **0.65** for `correlated_movement`, keep 0.85 for `team_news_shift`

This should 3-5x the volume of correlation signals while keeping team_news_shift high-quality.

### 2. Reduce Snapback Volume (it's at 22.7% — waste of alerts)

Add a minimum confidence floor of 70 for snapback alerts before they get dispatched to Telegram. This cuts the low-quality snapback noise and makes room for more correlation alerts.

### 3. Add "Yesterday's Signal Scorecard" to Accuracy Dashboard

New component showing a daily breakdown card:
- Date selector defaulting to yesterday
- Table of all signal types with hits/misses/pending for that day
- Highlight best and worst performers
- Show team_news_shift and correlated_movement results prominently at top

### 4. Yesterday's Parlay Results Card

Since the parlay generator hasn't produced recent data, add a visible "No recent parlays" state in the dashboard. When data exists, show W-L-P record for selected date.

## Technical Details

### Files Modified
- `supabase/functions/fanduel-behavior-analyzer/index.ts` — Lower correlation thresholds (lines 350, 365, 374)
- `supabase/functions/fanduel-prediction-alerts/index.ts` — Add snapback confidence floor before Telegram dispatch
- `src/components/accuracy/DailySignalScorecard.tsx` — New component
- `src/components/accuracy/UnifiedAccuracyView.tsx` — Add daily scorecard section

### Threshold Changes
```text
// behavior-analyzer line 350
Math.abs(diff) < 0.5  →  Math.abs(diff) < 0.3

// behavior-analyzer line 365  
shifts.length < 3  →  shifts.length < 2

// behavior-analyzer line 374
correlationRate >= 0.7  →  correlationRate >= 0.65

// prediction-alerts: snapback dispatch
Add: if (a.type === "snapback" && confidence < 70) skip Telegram
```

### Daily Scorecard Query
```sql
SELECT signal_type, 
  COUNT(*) FILTER (WHERE was_correct = true) as hits,
  COUNT(*) FILTER (WHERE was_correct = false) as misses,
  COUNT(*) FILTER (WHERE was_correct IS NULL) as pending
FROM fanduel_prediction_accuracy
WHERE created_at::date = $selected_date
GROUP BY signal_type
ORDER BY (hits + misses) DESC
```

## Scope
- 2 edge functions modified
- 1 new component + 1 component edited
- No migrations needed


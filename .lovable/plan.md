

## Add Quality Score Adjustment from Risk Tags

### What Changes

The `bot-parlay-smart-check` edge function currently returns risk tags and recommendations but no **quality score**. Adding a `quality_score` per leg that adjusts based on risk tags will let the UI sort flagged legs by actual quality — so the worst legs float to the top and L3-confirmed legs get credit.

### Scoring Logic

Each leg starts at a base score of **50** (neutral). Adjustments:

| Tag | Adjustment |
|-----|-----------|
| `L3_CONFIRMED` | +15 |
| `ELITE_MATCHUP` | +10 |
| `PRIME_MATCHUP` | +5 |
| `L3_BELOW_LINE` | -10 |
| `L3_ABOVE_LINE` (under pick) | -10 |
| `L3_DECLINE` | -20 |
| `L3_SURGE` (under pick) | -15 |
| `BLOWOUT_RISK` | -15 |
| `ELEVATED_SPREAD` | -5 |
| `PLAYER_OUT` | -50 |
| `PLAYER_DOUBTFUL` | -30 |
| `PLAYER_QUESTIONABLE` | -10 |
| `AVOID_MATCHUP` | -10 |
| `NO_L3_DATA` | -5 |
| `NO_MATCHUP_DATA` | 0 |

Score is clamped 0–100.

### Changes

#### 1. `bot-parlay-smart-check/index.ts`
- Add `quality_score: number` to `LegCheck` interface
- After computing all risk tags for a leg, calculate the score using the table above
- Sort each parlay's legs by `quality_score` ascending (worst first) in the response
- Add parlay-level `avg_quality` to `ParlayCheckResult`

#### 2. `ParlaySmartCheckPanel.tsx`
- Update `LegCheck` interface to include `quality_score`
- Display quality score as a colored badge next to each leg (red < 30, amber 30-60, green > 60)
- Sort flagged legs by `quality_score` ascending so worst legs appear first
- Show parlay-level average quality in the summary

### Files
1. `supabase/functions/bot-parlay-smart-check/index.ts` — add quality scoring
2. `src/components/parlays/ParlaySmartCheckPanel.tsx` — display and sort by quality score




## Recurring Winners Detector

### Overview
A new edge function that automatically identifies players who hit their sweet spot picks yesterday and appear again in today's sweet spots with 80%+ L10 hit rate. These "recurring winners" are the most reliable plays -- proven yesterday, flagged again today.

### How It Works

```text
Yesterday's Sweet Spots          Today's Sweet Spots
(outcome = 'hit')                (l10_hit_rate >= 80%)
        |                                |
        +-------- MATCH ON --------------+
        |  player_name + prop_type       |
        v                                v
   Recurring Winners List
   (sorted by composite score)
           |
           v
   Telegram Alert + Stored in DB
```

### Implementation

**1. New Database Table: `recurring_winners`**

Stores detected recurring winners each day for tracking and parlay generation reference.

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| analysis_date | date | Today's date |
| player_name | text | Player name |
| prop_type | text | e.g. player_points, player_threes |
| recommended_side | text | OVER / UNDER |
| yesterday_line | numeric | What line they hit yesterday |
| yesterday_actual | numeric | What they actually scored |
| today_line | numeric | Today's line |
| today_l10_hit_rate | numeric | Today's L10 hit rate |
| today_l10_avg | numeric | Today's L10 average |
| streak_days | integer | Consecutive days hitting (2 = hit yesterday + day before) |
| composite_score | numeric | Weighted score for ranking |
| created_at | timestamptz | Record timestamp |

**2. New Edge Function: `recurring-winners-detector`**

Logic:
1. Get yesterday's Eastern date
2. Query `category_sweet_spots` for yesterday where `outcome = 'hit'`
3. Query `category_sweet_spots` for today where `l10_hit_rate >= 80`
4. Match on `player_name + prop_type + recommended_side`
5. For each match, check if they also appear in `recurring_winners` from yesterday (streak detection)
6. Calculate composite score: `(l10_hit_rate * 0.5) + (streak_days * 10) + (edge * 0.3)`
7. Upsert into `recurring_winners` table
8. Send Telegram report with tiered breakdown

**3. Pipeline Integration**

Add to `data-pipeline-orchestrator` Phase 2 (Analysis), right after `double-confirmed-scanner`:

```text
double-confirmed-scanner  -->  recurring-winners-detector
```

This ensures sweet spots are already populated for today before the detector runs.

**4. Telegram Report Format**

```text
RECURRING WINNERS - Feb 22

STREAK PLAYERS (3+ days):
  Desmond Bane | Threes OVER 2.5 | 100% L10 | 3-day streak

REPEAT HITTERS (hit yesterday + today 80%+):
  Grayson Allen | Points OVER 13.5 | 90% L10
  Paolo Banchero | Assists OVER 4.5 | 90% L10
  Jalen Smith | Points UNDER 11.5 | 100% L10

Total: 4 recurring winners from 45 sweet spots
```

### Technical Details

**File: `supabase/functions/recurring-winners-detector/index.ts`** (new)
- Queries yesterday's `category_sweet_spots` with `outcome = 'hit'`
- Cross-references today's `category_sweet_spots` with `l10_hit_rate >= 80`
- Detects streaks by checking prior `recurring_winners` entries
- Upserts results and sends Telegram alert

**File: `supabase/functions/data-pipeline-orchestrator/index.ts`**
- Add `await runFunction('recurring-winners-detector', {})` after the `double-confirmed-scanner` call (line 135)

**Database migration:**
- Create `recurring_winners` table with the schema above
- Add unique constraint on `(analysis_date, player_name, prop_type)` to prevent duplicates

**File: `supabase/functions/telegram-webhook/index.ts`**
- Add `/recurringwinners` command to trigger the detector on demand

### What This Enables Next
- The parlay generator can prioritize recurring winners as a new source tag (`recurring_winner`)
- Streak data feeds into confidence scoring -- a 3-day streak player is more reliable than a first-time pick
- Historical tracking shows which players are consistently profitable across multiple days

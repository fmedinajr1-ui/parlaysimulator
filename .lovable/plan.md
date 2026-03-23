

# Fix DNA Audit: Missing Player Stats in Parlay Legs

## Root Cause

The DNA audit is still voiding 100% of parlays — but NOT because of the FanDuel line fix (that's working: all legs now have `has_real_line: true`).

The real problem: **`bot-generate-daily-parlays` doesn't embed player stats in the leg JSON**. Each leg has `line`, `player_name`, `side`, `american_odds` etc., but is missing critical fields the DNA scorer needs:

- `l10_avg` → defaults to 0 → buffer becomes -100% for overs → `NEG_BUFFER` flag
- `l3_avg`, `l5_avg`, `season_avg` → all 0 → garbage DNA signals
- `l10_std_dev`, `confidence_score` → 0 → low DNA score → `LOW_DNA` flag

With all signals at 0, EVERY leg gets flagged as weak. When all legs are weak and fewer than 2 remain after pruning, the parlay gets F-graded and voided.

## Two-Pronged Fix

### Fix 1: Enrich parlay legs with stats from `category_sweet_spots`

In `bot-generate-daily-parlays/index.ts`, when building each leg object, carry forward the stats from the sweet spot pick that sourced it. The sweet spots already have `l10_avg`, `l3_avg`, `l5_avg`, `l10_std_dev`, `season_avg`, `confidence_score`, `matchup_adjustment`, `pace_adjustment`, `h2h_matchup_boost`, `bounce_back_score`.

Add these fields to the leg JSON:
```typescript
{
  ...existingLegFields,
  l10_avg: pick.l10_avg,
  l3_avg: pick.l3_avg,
  l5_avg: pick.l5_avg,
  l10_std_dev: pick.l10_std_dev,
  season_avg: pick.season_avg,
  confidence_score: pick.confidence_score,
  matchup_adjustment: pick.matchup_adjustment || 0,
  pace_adjustment: pick.pace_adjustment || 0,
  h2h_matchup_boost: pick.h2h_matchup_boost || 0,
  bounce_back_score: pick.bounce_back_score || 0,
}
```

### Fix 2: Make DNA scorer resilient to missing stats

In `score-parlays-dna/index.ts`, if `l10Avg` is 0 or missing, skip buffer calculation and DNA scoring for that leg — don't flag it, just score it as neutral (50). This prevents future regressions if any leg source doesn't have stats.

```typescript
// If no L10 avg data, skip scoring — don't penalize
if (l10Avg === 0 && line > 0) {
  // No stats available, assign neutral score
  dnaScore = 50;
  bufferPct = 0;
  // Don't add any flags
}
```

## Files Changed

1. **`supabase/functions/bot-generate-daily-parlays/index.ts`** — Add player stat fields to leg objects when building parlays
2. **`supabase/functions/score-parlays-dna/index.ts`** — Handle missing stats gracefully (neutral score instead of flagging)

## Expected Impact
- Legs will carry real stats → DNA scoring actually works
- Fallback: if stats missing, leg scores neutral (50) instead of being flagged
- Void rate drops from 100% to only genuinely weak parlays


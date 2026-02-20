

## Returning-Hitter Confidence Boost (+0.05)

### What it does
After the pick pool is fully built (filtered, penalized, defense-adjusted), query yesterday's settled parlay legs to identify players who **hit** their prop. Any pick in today's pool whose player hit yesterday gets a +0.05 boost to `confidence_score` and `l10_hit_rate`, capped at 1.0.

### Where it appears in the pipeline
Right before the pool is returned (line ~3920 in `bot-generate-daily-parlays/index.ts`), after defense matchup adjustments and before parlay assembly. This ensures the boost stacks on top of all other adjustments.

### Logic

1. Compute yesterday's date string (Eastern time, same helper already used in the file)
2. Query `bot_parlay_legs` for yesterday's date where `outcome = 'hit'`
3. Build a Set of normalized player names who hit
4. Loop through `enrichedSweetSpots` -- if the player is in the returning-hitter set, add +0.05 to `confidence_score` and `l10_hit_rate` (capped at 1.0), and add +3 to `compositeScore` (capped at 99)
5. Log how many picks received the boost

### Technical Details

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

**Insertion point:** After line 3918 (after defense matchup adjustments), before the pool summary log on line 3920.

**New code block (~25 lines):**

```typescript
// === RETURNING HITTER BOOST ===
try {
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(yesterdayDate);

  const { data: yesterdayHits } = await supabase
    .from('bot_parlay_legs')
    .select('player_name')
    .eq('outcome', 'hit')
    .gte('created_at', `${yesterdayStr}T00:00:00`)
    .lt('created_at', `${targetDate}T00:00:00`);

  if (yesterdayHits && yesterdayHits.length > 0) {
    const hittersSet = new Set(
      yesterdayHits.map(h => (h.player_name || '').toLowerCase().trim())
    );
    hittersSet.delete('');
    let boosted = 0;
    for (const pick of enrichedSweetSpots) {
      if (hittersSet.has(pick.player_name.toLowerCase().trim())) {
        pick.confidence_score = Math.min(1.0, pick.confidence_score + 0.05);
        pick.l10_hit_rate = Math.min(1.0, pick.l10_hit_rate + 0.05);
        pick.compositeScore = Math.min(99, pick.compositeScore + 3);
        boosted++;
      }
    }
    console.log(`[ReturningHitter] Boosted ${boosted} picks from ${hittersSet.size} players who hit yesterday (${yesterdayStr})`);
  } else {
    console.log(`[ReturningHitter] No yesterday hit data found, skipping boost`);
  }
} catch (rhErr) {
  console.log(`[ReturningHitter] ⚠️ Failed to apply boost: ${rhErr.message}`);
}
```

**No other files or schema changes needed.** The `bot_parlay_legs` table already stores `player_name`, `outcome`, and `created_at`.


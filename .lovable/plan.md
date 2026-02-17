

# Monster Parlay Challenge: +10,000 Odds AI Parlay

## What This Does
Adds a new "Monster Parlay" generation pass that runs automatically on big-slate days (6+ games across 2+ sports). The AI cherry-picks its highest-accuracy legs and assembles a 6-8 leg mega parlay targeting +10,000 or higher odds -- but every leg is backed by real accuracy data (60%+ hit rates, positive edge, strong composite scores). Think of it as the AI's "best shot at a moonshot."

## How It Works

1. **Slate Detection**: Only generates Monster Parlays when the daily pool has 15+ quality candidates across 2+ sports (big-slate days with NBA, NHL, NCAAB all active). On light-slate days, it skips entirely.

2. **Leg Selection (Accuracy-First)**:
   - Pulls from the full deduplicated candidate pool (player props, team picks, whale signals, sweet spots)
   - Every leg must have: hit rate >= 55%, composite score >= 60, positive edge
   - Sorts by hit rate descending (best accuracy first)
   - Enforces diversity: max 2 legs per sport, max 1 leg per team, no mirror/correlated pairs
   - No same-game parlays (avoids correlation tax)

3. **Odds Targeting**:
   - Starts with the top 6 legs and calculates combined odds
   - If below +10,000, adds legs one at a time (up to 8 total) until the threshold is crossed
   - If the top 8 legs still can't reach +10,000, it uses alternate/boosted lines on 1-2 legs to push odds higher while maintaining the accuracy floor
   - Hard cap: never exceeds 8 legs (keeps it ambitious but not delusional)

4. **Output**: Creates 1-2 Monster Parlays per day (one conservative at exactly +10,000, one aggressive pushing +15,000-25,000 if enough quality legs exist)

## Technical Details

### File Modified
`supabase/functions/bot-generate-daily-parlays/index.ts`

### Change Location
New function `generateMonsterParlays()` added after the existing `generateBankrollDoubler()` function (around line 4144). Called from the main orchestrator after standard tier generation but before the mini-parlay/single fallback.

### New Function: `generateMonsterParlays()`

```text
async function generateMonsterParlays(
  pool, globalFingerprints, targetDate, supabase
) {
  // 1. Big-slate gate: need 15+ quality candidates across 2+ sports
  const allCandidates = [...pool.playerPicks, ...pool.teamPicks, ...pool.whalePicks, ...pool.sweetSpots]
    .filter(p => (p.hit_rate >= 55) && (p.compositeScore >= 60) && (p.edge > 0))
    .deduplicate by player/team key (keep highest composite)
    .sort by hit_rate descending

  const activeSports = new Set(allCandidates.map(c => c.sport))
  if (allCandidates.length < 15 || activeSports.size < 2) return []

  // 2. Greedy leg selection with diversity constraints
  function selectLegs(candidates, targetOdds = 10000, maxLegs = 8) {
    const selected = []
    const usedTeams = new Set()
    const sportCount = {}

    for (const pick of candidates) {
      if (selected.length >= maxLegs) break
      if (usedTeams.has(pick.team)) continue
      if ((sportCount[pick.sport] || 0) >= 2) continue
      if (hasMirror(selected, pick)) continue
      if (hasCorrelation(selected, pick)) continue

      selected.push(pick)
      usedTeams.add(pick.team)
      sportCount[pick.sport] = (sportCount[pick.sport] || 0) + 1

      // Check if we've hit the odds target with 6+ legs
      if (selected.length >= 6) {
        const combinedOdds = calculateCombinedAmericanOdds(selected)
        if (combinedOdds >= targetOdds) break
      }
    }
    return selected
  }

  // 3. Build Conservative Monster (+10,000 target)
  const conservativeLegs = selectLegs(allCandidates, 10000, 8)
  const conservativeOdds = calculateCombinedAmericanOdds(conservativeLegs)

  if (conservativeOdds < 10000 || conservativeLegs.length < 6) return [] // Not enough quality

  const monsters = []

  // Conservative Monster
  monsters.push({
    parlay_date: targetDate,
    legs: conservativeLegs.map(formatLeg),
    leg_count: conservativeLegs.length,
    combined_probability: calculateCombinedProb(conservativeLegs),
    expected_odds: conservativeOdds,
    strategy_name: 'monster_parlay_conservative',
    tier: 'monster',
    is_simulated: true,
    simulated_stake: 10,
    simulated_payout: 10 * americanToDecimal(conservativeOdds),
    selection_rationale: `Monster Parlay: ${conservativeLegs.length} accuracy-first legs targeting +${conservativeOdds}. Avg hit rate: ${avgHitRate}%. Every leg has 55%+ historical accuracy.`,
  })

  // 4. Aggressive Monster (+15,000-25,000) if pool allows
  const remainingCandidates = allCandidates.filter(not in conservativeLegs)
  if (remainingCandidates.length >= 2) {
    const aggressiveLegs = selectLegs(allCandidates, 15000, 8)
    // ... same structure, higher target
  }

  // 5. Dedup + insert
  return monsters
}
```

### Integration Point
In the main generation orchestrator (around line 4560), after tier generation:

```text
// === MONSTER PARLAY (big-slate only) ===
const monsterParlays = await generateMonsterParlays(pool, globalFingerprints, targetDate, supabase);
if (monsterParlays.length > 0) {
  allParlays.push(...monsterParlays);
  console.log(`[Bot v2] Monster parlays: ${monsterParlays.length} created (${monsterParlays.map(m => '+' + m.expected_odds).join(', ')})`);
}
```

### UI Updates

**`src/components/bot/BotParlayCard.tsx`**: Add monster tier styling
- Border color: `border-l-red-500` (fiery red for monster)
- Badge: skull/fire emoji with "+10,000" odds highlight

**`src/components/bot/TierBreakdownCard.tsx`**: Add monster tier to breakdown
- Icon: flame or skull
- Label: "Monster"
- Color: red/fire theme

### Key Constraints
- Minimum 6 legs, maximum 8 legs
- Every leg must have 55%+ hit rate and 60+ composite score
- Max 2 legs per sport, max 1 per team
- No same-game legs, no mirror pairs
- Only generates on big-slate days (15+ candidates, 2+ sports)
- Targets +10,000 minimum combined odds
- $10 stake (small bet, big upside)
- Uses `globalFingerprints` for deduplication with existing parlays

### No Database Changes
Uses the existing `bot_daily_parlays` table -- the `tier` field accepts any string value, and `strategy_name` is already flexible.

## What You'll See
On a busy NBA + NHL + NCAAB night, the bot dashboard will show 1-2 Monster Parlays at the top with a fiery red accent, displaying something like:

> **Monster Parlay** -- 7 Legs -- +12,450 Odds
> $10 to win $1,255 -- Avg Hit Rate: 62%
> "Every leg has 55%+ accuracy. The AI's best moonshot."

On light-slate days (like today with only NCAAB), Monster Parlays are skipped entirely -- no low-quality longshots.


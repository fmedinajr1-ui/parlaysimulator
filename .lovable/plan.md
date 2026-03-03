

## Plan: Lottery Double-Double Intelligence Rules

### Problem
Currently, the lottery scanner can include multiple `player_double_double` picks from the same team, and DD picks aren't validated against opponent defense strength. This leads to correlated/low-value DD selections.

### Changes (1 file)

**`supabase/functions/nba-mega-parlay-scanner/index.ts`**

#### Rule 1: No same-team Double-Double picks
In the `passesBasicChecks` function (line ~835), add a check: if the candidate is a `player_double_double` prop, scan `existingLegs` for any other `player_double_double` leg from the same game. If found, block it. This prevents two DD picks from players on the same team (or even the same game, which is the safer approach since teams in the same game are correlated).

#### Rule 2: DD picks only when opponent defense is weak in 2+ categories
Before scoring DD props (around line 634-639 where exotic hit rates are assigned), add a defense gate specifically for `player_double_double`:
- Look up the opponent's defense ranks in points, rebounds, and assists
- Count how many of those ranks are >= 18 (weak defense = allows a lot)
- Only allow the DD pick if at least 2 of the 3 categories show a weak opponent (rank >= 18)
- If the opponent is strong defensively in 2+ categories, skip the DD pick entirely

### Technical Details

1. **Same-team DD block** -- Add to `passesBasicChecks`:
```typescript
// Block same-game double-double picks
if (prop.prop_type === 'player_double_double') {
  const existingDD = existingLegs.filter(
    l => l.prop_type === 'player_double_double' && l.game === prop.game
  );
  if (existingDD.length > 0) return false;
}
```

2. **Defense gate for DD** -- Add in the scoring loop (around line 634), before the exotic hit rate assignment:
```typescript
// DD picks: require opponent weak in 2+ categories (rank >= 18)
if (prop.prop_type === 'player_double_double') {
  const oppTeam = /* determine opponent from home/away */;
  const oppPtsRank = getDefenseRank(oppTeam, 'player_points');
  const oppRebRank = getDefenseRank(oppTeam, 'player_rebounds');
  const oppAstRank = getDefenseRank(oppTeam, 'player_assists');
  const weakCategories = [oppPtsRank, oppRebRank, oppAstRank]
    .filter(r => r !== null && r >= 18).length;
  if (weakCategories < 2) continue; // Skip DD against strong defenses
}
```

The opponent is determined by checking if the player's team is the home or away team in the event data (using `home_team`/`away_team` fields already available on each prop).

Edge function will be redeployed automatically after changes.


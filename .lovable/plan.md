

# NBA Bidirectional Matchup Engine — Offense + Defense Scanner

## Problem
The existing `bot-matchup-defense-scanner` only looks at **defensive** rankings (what the opponent allows). It ignores the **offensive** side — whether the attacking team is actually good at that stat category. A weak defense against 3PT means nothing if the attacking team ranks 28th in 3PT offense.

## What Already Exists
- `team_defense_rankings` table has **both** sides: `opp_points_rank`, `opp_threes_rank`, etc. (defense) AND `off_points_rank`, `off_threes_rank`, etc. (offense) — all 30 teams, current data.
- The current scanner only queries defense columns and classifies matchups as prime/favorable/avoid based on defense alone.
- The parlay generator already has a bidirectional `matchupFactor = oppDefenseRank * 0.6 + teamOffenseRank * 0.4` formula but the **scanner** that feeds `bot_research_findings` doesn't use it.

## Plan

### Upgrade `bot-matchup-defense-scanner/index.ts`

**1. Load offense + defense ranks together**
- Expand the query to include `off_points_rank, off_rebounds_rank, off_assists_rank, off_threes_rank, off_pace_rank`
- Build a single map with both offensive and defensive profiles per team

**2. Add bidirectional matchup scoring**
For each game + stat category, compute a combined matchup score:
```
matchupScore = (oppDefenseRank * 0.6) + (teamOffenseRank_inverted * 0.4)
```
Where `teamOffenseRank_inverted = 31 - off_rank` (rank 1 offense = strongest = 30 inverted).

This means:
- **Elite matchup**: Team ranked top-5 offensively in stat AND opponent ranked bottom-5 defensively → both factors high
- **Misleading matchup**: Weak defense but the attacking team also bad at that stat → score stays low
- **Avoid**: Strong defense AND attacking team is weak offensively → double penalty

**3. New classification tiers**
```
Combined score >= 22: "elite"   (top offense vs bottom defense)
Combined score >= 18: "prime"   (strong mismatch)
Combined score >= 14: "favorable" (moderate edge)
Combined score <= 8:  "avoid"   (tough matchup)
```

**4. Enhanced recommendations output**
Each recommendation now includes:
- `offense_rank`: How good the attacking team is at this stat
- `defense_rank`: How bad the defending team is at allowing this stat  
- `matchup_score`: Combined bidirectional score
- `matchup_label`: "elite" / "prime" / "favorable" / "neutral" / "avoid"
- `prop_recommendations`: Which prop types benefit (points OVER, threes OVER, etc.)

**5. Persist to `bot_research_findings`**
Same upsert pattern but with richer `key_insights` containing offense context. Downstream consumers (parlay generator, AI reviewer) get the full picture.

### Files Changed
1. **`supabase/functions/bot-matchup-defense-scanner/index.ts`** — expand to bidirectional offense+defense matchup scoring, new classification tiers, richer output

No new tables or migrations needed — all data already exists.


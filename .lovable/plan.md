

## Wire Game Context + Per-Player Matchup Signals Into Parlay Generator

### The Gap

The generator currently has the **Day Type Classifier** (aggregate signal: "today is a Threes day") but is completely blind to **per-game and per-player matchup conditions**. Two critical data sources are generated daily but never consumed:

1. **Game Context Analyzer** (`bot-game-context-analyzer`) — writes revenge games, B2B fatigue, blowout risk, and thin slate flags to `bot_research_findings` under category `game_context`. The generator never reads this.

2. **Bidirectional Matchup Scanner** — writes per-player matchup grades (A+/A/B/C/D), exploitable zones, and prop edge types to `bot_research_findings` under category `matchup_defense_scan`. The Day Type Classifier only reads the aggregate summary text, not the per-player grades.

This means a player with an A+ matchup grade gets no scoring advantage over a player with a D grade. A player on a B2B fatigue team gets no penalty. A game flagged as blowout risk has no impact on leg selection.

### Changes to `bot-generate-daily-parlays/index.ts`

#### 1. Fetch game context flags at pipeline start (~30 lines)
Add `fetchGameContextFlags()` that queries `bot_research_findings` where `category = 'game_context'` for today. Parse the `key_insights` JSON to extract an array of context flags (revenge, B2B fatigue, blowout risk). Store in a module-level `gameContextFlags` map keyed by team name.

#### 2. Fetch per-player matchup grades (~40 lines)
Add `fetchPlayerMatchupGrades()` that queries `bot_research_findings` where `category = 'matchup_defense_scan'` for today. Parse per-player entries to extract: `overallGrade`, `overallScore`, `propEdgeType`, `recommendedSide`. Store in a module-level `playerMatchupMap` keyed by player name.

#### 3. Add `getMatchupContextBoost()` function (~35 lines)
Given a player name, team, and prop type, returns a combined boost/penalty:

| Signal | Boost |
|--------|-------|
| Player matchup grade A+ | +10 |
| Player matchup grade A | +6 |
| Player matchup grade B+ | +3 |
| Player matchup grade C/D | -4 |
| Prop type matches player's `propEdgeType` | +5 |
| Prop contradicts player's `propEdgeType` | -3 |
| Team on B2B fatigue | -6 |
| Revenge game for team | +5 |
| Game flagged blowout risk | -8 |

These stack with existing Day Type boost and category tier signals.

#### 4. Wire into all three `calculateCompositeScore` call sites
At lines ~4966, ~5522, and ~9635, add `getMatchupContextBoost()` alongside the existing `getDayTypeBoost()` call:
```
compositeScore += getDayTypeBoost(prop_type, currentDayTypeSignal);
compositeScore += getMatchupContextBoost(playerName, teamName, prop_type);
```

#### 5. Add hard gate for blowout risk games
After composite scoring, skip any leg where the game is flagged as blowout risk AND the composite score is below 55. This prevents low-confidence picks in games likely to see bench players in Q4.

#### 6. Log context signals at pipeline start
```
[Bot v2] 🎯 Game Context: 2 revenge games, 1 B2B fatigue, 1 blowout risk
[Bot v2] 🎯 Matchup Grades loaded: 47 players (12 A+/A, 20 B+/B, 15 C/D)
```

### Scope
- **Modified:** `supabase/functions/bot-generate-daily-parlays/index.ts` (~120 lines added)
- No new files, no database changes
- Redeploy edge function after changes

### Testing Plan
After implementation, run 5 verification tests:
1. Confirm `fetchGameContextFlags()` returns parsed flags from today's `bot_research_findings`
2. Confirm `fetchPlayerMatchupGrades()` returns player-level grades
3. Simulate a player with A+ grade + revenge game — verify composite boost stacks correctly
4. Simulate a player on B2B fatigue team in blowout game — verify penalty + hard gate
5. Full pipeline invocation to confirm no runtime errors


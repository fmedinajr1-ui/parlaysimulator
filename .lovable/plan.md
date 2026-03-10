

## NBA L3 + Matchup Rankings 5-Leg Parlay Strategy

### Problem
Today's NBA sweet spots almost all have `l3_avg: NULL` because the `category-props-analyzer` hasn't re-run with fresh data. The existing `sweet_spot_l3` strategy doesn't cross-reference matchup rankings — it only sorts by L3 score (distance from line). You want a hybrid strategy that combines both L3 recency momentum AND favorable defensive matchups.

### Today's NBA Slate (11 games)
MEM@PHI, DAL@ATL, DET@BKN, WAS@MIA, TOR@HOU, PHX@MIL, BOS@SAS, CHI@GSW, CHA@POR, IND@SAC, MIN@LAL

### Weakest Defenses on Today's Slate (targets for OVER)
| Team | Pts Rank | Reb Rank | Ast Rank | 3s Rank |
|------|----------|----------|----------|---------|
| ATL  | 27       | 26       | 27       | 27      |
| POR  | 25       | 25       | 26       | 26      |
| SAC  | 28       | 28       | 28       | 28      |
| SAS  | 23       | 24       | 24       | 22      |
| BKN  | 21       | 22       | 21       | 21      |
| PHI  | 18       | 17       | 17       | 17      |

### Plan

#### 1. Re-run `category-props-analyzer` to backfill `l3_avg`
Invoke with `forceRefresh: true` so all NBA sweet spots get fresh L3 data. This is the prerequisite — without it, the NULL L3 gate blocks everything.

#### 2. Add new strategy: `l3_matchup_combo`
Add a new strategy block in `bot-generate-daily-parlays/index.ts` that:
- Filters NBA sweet spots where `l3_avg` is not null AND `l3_avg > actual_line` (for OVER)
- Cross-references `team_defense_rankings` to find which opponent the player faces today
- Computes a **combined score**: `l3_score * 0.5 + matchup_rank_score * 0.5`
  - `l3_score` = `l3_avg - line` (how far above the line the L3 avg is)
  - `matchup_rank_score` = opponent's defense rank in the relevant category (e.g., `opp_points_rank` for points props, `opp_rebounds_rank` for rebounds)
- Requires opponent defense rank >= 18 (bottom half) to qualify
- Builds 5-leg parlay from top-scoring candidates
- Added to `PRIORITY_STRATEGIES` to bypass diversity cap

#### 3. Add 3 profiles (exploration tier)
```typescript
{ legs: 5, strategy: 'l3_matchup_combo', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'combined_l3_matchup' },
{ legs: 5, strategy: 'l3_matchup_combo', sports: ['basketball_nba'], minHitRate: 50, sortBy: 'combined_l3_matchup' },
{ legs: 4, strategy: 'l3_matchup_combo', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'combined_l3_matchup' },
```

#### 4. Implementation in the profile loop
When `profile.strategy === 'l3_matchup_combo'`:
1. Load today's NBA games from `game_bets` to map player teams → opponents
2. Load `team_defense_rankings` (already available in pool or fetched)
3. Filter sweet spots: NBA only, `l3_avg` not null, L3 clears line, opponent defense rank >= 18
4. Score each pick: normalize L3 margin + defense rank into combined score
5. Sort by combined score, take top N legs
6. Skip ScoreGate/GodMode/ProjectionBuffer gates (same exemption as `sweet_spot_l3`)

#### 5. Broadcast the parlay via Telegram
After generation, trigger `bot-send-telegram` to send the L3+Matchup parlay to users.

### Files to Edit
1. `supabase/functions/bot-generate-daily-parlays/index.ts` — add `l3_matchup_combo` strategy detection, profile entries, and assembly logic
2. `supabase/functions/broadcast-new-strategies/index.ts` — add `l3_matchup_combo` to broadcast whitelist

### Expected Output Example
```
🔥 NBA L3 + MATCHUP 5-LEG PARLAY

Leg 1: Luka Doncic OVER 28.5 PTS vs ATL (DEF #27)
  L3: 31.2 avg | L10: 90% hit rate
Leg 2: Pascal Siakam OVER 4.5 AST vs SAC (DEF #28)  
  L3: 6.0 avg | L10: 100% hit rate
...
```

### Invocation Sequence
1. `category-props-analyzer` (forceRefresh) → backfill L3
2. Deploy updated `bot-generate-daily-parlays`
3. Invoke `bot-generate-daily-parlays` → build parlay
4. `bot-send-telegram` → broadcast


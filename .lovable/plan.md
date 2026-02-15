

# Add Tennis and Table Tennis Research Intelligence via Perplexity

## Problem
The parlay generator has 8 profiles for tennis/table tennis, but the AI Research Agent feeds zero intelligence for these sports. There are no Perplexity queries for tennis surface analysis, player form, head-to-head records, or table tennis sharp signals. The profiles are generating blind -- no research boosts, no injury intel, no sharp signals.

## Solution
Add 3 new Perplexity research categories to the AI Research Agent, then wire a new `fetchResearchTennisIntel` function in the parlay generator to consume them as composite score boosts.

## Changes

### 1. AI Research Agent -- Add 3 New Categories

**File: `supabase/functions/ai-research-agent/index.ts`**

Add to `RESEARCH_QUERIES`:

**Category: `tennis_sharp_signals`**
- Query: Today's sharpest ATP/WTA tennis betting signals -- line movements on match winners, set totals, game spreads. Where is professional money loading? Any steam moves on specific matches? Include surface-specific edges (hard court, clay, grass).
- System prompt: Tennis market analyst. Extract specific player names, match odds movements, surface factors, and sharp/public money splits.

**Category: `tennis_form_matchups`**
- Query: Today's ATP/WTA tennis matches -- player recent form (last 5-10 matches), head-to-head records, surface win rates, fatigue from recent tournaments, any injury concerns or withdrawals. Which favorites are vulnerable? Which underdogs have strong surface-specific records?
- System prompt: Tennis matchup analyst. Provide win/loss records, surface-specific stats, H2H records, and flag players on fatigue (3+ matches in last 5 days) or returning from injury.

**Category: `table_tennis_signals`**
- Query: Today's international table tennis matches and betting signals. Include ITTF events, WTT events, and major league matches. Any sharp line movements on match winners or total games? Which players are in strong form or dealing with fatigue from back-to-back tournaments?
- System prompt: Table tennis betting analyst. Focus on player form, recent results, head-to-head records, and any sharp money signals. Table tennis has high volume and fast turnover -- flag players on 3+ match days.

Update `titleMap` and `emojiMap` to include:
- `tennis_sharp_signals`: "Tennis Sharp Signals" (emoji: tennis ball)
- `tennis_form_matchups`: "Tennis Form and Matchups" (emoji: tennis ball)
- `table_tennis_signals`: "Table Tennis Signals" (emoji: ping pong)

Update `markResearchConsumed` to include the 3 new categories.

### 2. Parlay Generator -- Consume Tennis/TT Research

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

Add new function `fetchResearchTennisIntel`:
- Reads from `bot_research_findings` where category is in `['tennis_sharp_signals', 'tennis_form_matchups', 'table_tennis_signals']`
- Extracts:
  - **Sharp signals**: player names with directional bias (moneyline favorite/underdog, over/under on games)
  - **Form flags**: players on hot streaks (boost +6) or cold/fatigued (penalty -4, or block from parlay legs)
  - **Surface edges**: hard court specialists on hard court matches get +5 boost
- Returns a `Map<string, { boost: number; direction: string }>` keyed by lowercase player name

Wire into `buildPropPool`:
- Add `fetchResearchTennisIntel` to the parallel `Promise.all` call (line ~1592)
- Apply boosts to team picks where sport matches `tennis_atp`, `tennis_wta`, or `tennis_pingpong`
- Boost logic: when a team pick's `home_team` or `away_team` matches a researched player name, add the boost to composite score

### 3. Scoring Boosts (Applied in Composite Score)

| Signal Type | Boost | Condition |
|-------------|-------|-----------|
| Tennis sharp signal (same direction) | +7 | Sharp money aligns with pick direction |
| Tennis form -- hot streak | +6 | Player won 4+ of last 5 matches |
| Tennis form -- cold/fatigued | -4 | Player lost 3+ of last 5 or playing 3rd+ match in 2 days |
| Surface specialist alignment | +5 | Player's surface win rate mentioned as above 70% |
| Table tennis sharp signal | +6 | Sharp money on specific TT match |
| Table tennis fatigue flag | -3 | Player on 3+ match day |

### 4. Files to Edit

1. `supabase/functions/ai-research-agent/index.ts` -- add 3 research queries + title/emoji maps
2. `supabase/functions/bot-generate-daily-parlays/index.ts` -- add `fetchResearchTennisIntel` + wire into pool builder + apply boosts

### 5. What This Enables

- Tennis parlays get Perplexity-powered intelligence on form, surface, and sharp money
- Table tennis parlays get form and sharp signal awareness
- Fatigued players are penalized or blocked, preventing bad legs
- The existing nighttime profiles (`nighttime_mixed`, `validated_tennis`, `validated_nighttime`) benefit from research-boosted composite scores instead of running blind


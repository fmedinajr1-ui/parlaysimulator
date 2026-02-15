

# Bot Profit Review and Smarter Parlay Building for Today

## Winning Pattern Analysis (from historical data)

Here is what the bot's profitable days reveal:

**Profitable Days**: Feb 9 (+$1,734), Feb 11 (+$342), Feb 12 (+$106), Feb 13 (+$358)
**Losing Days**: Feb 10 (-$40), Feb 14 (-$40)

**What wins consistently:**
- 3-leg parlays dominate wins (12 of 24 wins)
- NCAAB spreads and totals are the strongest team-prop category
- Exploration tier produces the most volume wins but validation/execution tiers produce more reliable ones
- Team-based legs (spreads, totals, ML) win more consistently than player props
- Average winning probability sits around 0.16-0.37 (not too aggressive)
- Winning parlays average +$58-$124 profit per hit

**What loses:**
- Feb 14: All 4 parlays lost -- all were NCAAB OVER totals that missed badly (lines too high)
- Heavy OVER total concentration without diversification is the primary failure mode

## Plan: "Replay Winning Patterns" Edge Function

Create a new edge function `bot-review-and-optimize` that:

1. **Analyzes profitable days** -- queries `bot_daily_parlays` for winning parlays, extracts common patterns (leg count, categories, bet types, sports mix)
2. **Scores today's candidates** against those patterns -- boosts candidates matching winning templates, penalizes those matching losing templates
3. **Triggers optimized generation** -- calls `bot-generate-daily-parlays` with pattern-replay insights injected

### Implementation

**New Edge Function**: `supabase/functions/bot-review-and-optimize/index.ts`

Steps:
1. Query all won/lost parlays, group by strategy patterns
2. Calculate pattern scores: win rate by (leg_count, bet_type combo, sport combo)
3. Identify "hot patterns" (e.g., 3-leg NCAAB spreads = 100% win rate) and "cold patterns" (e.g., 3+ OVER totals in same parlay = 0% win rate on Feb 14)
4. Store findings in `bot_research_findings` as an "optimization" type entry
5. Call `bot-generate-daily-parlays` with a `pattern_replay` flag and the winning template data

**UI Addition**: Add a "Smart Generate" button to the Bot Dashboard that triggers this review-then-generate flow instead of raw generation.

### Modified Files

1. **New**: `supabase/functions/bot-review-and-optimize/index.ts`
   - Queries historical wins/losses
   - Computes pattern scores
   - Stores optimization findings
   - Calls generation with replay data

2. **Modified**: `src/pages/BotDashboard.tsx`
   - Add "Smart Generate" button alongside existing Generate button
   - Calls `bot-review-and-optimize` instead of direct generation
   - Shows toast with pattern analysis summary

3. **Modified**: `supabase/functions/bot-generate-daily-parlays/index.ts`
   - Accept optional `winning_patterns` in request body
   - Apply pattern-based score boosts/penalties during candidate selection
   - Cap OVER total concentration to max 2 per parlay (anti-Feb-14 rule)

### Key Optimization Rules (derived from data)

- Prioritize 3-leg parlays in execution tier (highest win rate)
- Mix bet types within parlays (spread + total outperforms pure totals)
- Cap same-category legs at 2 per parlay (prevent OVER total stacking)
- Boost NCAAB spread candidates (100% win rate historically)
- Penalize pure OVER total parlays with 3+ legs of same type
- Weight validation tier team parlays higher (strong P&L ratio)


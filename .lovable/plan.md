

# MLB Cascade Parlay Generator

## What We're Building
New edge function `mlb-cascade-parlay-generator` that pulls today's cascade Under RBI picks from `straight_bet_tracker`, fetches real odds via `fetch-batch-odds`, and generates 20 parlay tickets with $10 stakes.

## Key Changes

### 1. Fix odds in straight_bet_tracker
The current `-130` is wrong for Under 0.5 RBI. These lines are typically `-350` to `-400`. The new function will fetch real odds from The Odds API via `fetch-batch-odds` before building parlays.

### 2. New function: `supabase/functions/mlb-cascade-parlay-generator/index.ts`

**Flow:**
1. Pull today's cascade picks from `straight_bet_tracker` (73 players)
2. Call `fetch-batch-odds` with all players for `batter_rbis` market to get real Under 0.5 RBI odds (~-350 to -400)
3. Shuffle the pool and build **20 unique parlay tickets** with varying leg counts:
   - **8 tickets × 3 legs** (GRIND tier, ~+100 to +150 combined)
   - **7 tickets × 5 legs** (STACK tier, ~+300 to +450 combined)
   - **5 tickets × 8 legs** (LONGSHOT tier, ~+800 to +1200 combined)
4. Each player used **at most once across all 20 tickets** (73 players covers: 8×3 + 7×5 + 5×8 = 24+35+40 = 99 slots — may need to allow reuse or reduce leg counts slightly)
5. **$10 stake** per ticket ($200 total daily risk)
6. Insert into `bot_daily_parlays` with `strategy_name: 'mlb_cascade_parlays'`
7. Broadcast all 20 tickets to Telegram in HTML format

**Dedup & constraints:**
- Max 2 players from same game per ticket
- Shuffle for variety across tickets

### 3. Also update `straight-bet-slate/index.ts`
Update the default odds from `-130` to `-375` (approximate Under 0.5 RBI market) so future straight bet records reflect realistic odds.

## Stake & Risk
- 20 tickets × $10 = **$200 total daily risk**
- All Under 0.5 RBI at real market odds

## Files
- **Create**: `supabase/functions/mlb-cascade-parlay-generator/index.ts`
- **Edit**: `supabase/functions/straight-bet-slate/index.ts` (fix default odds from -130 to -375)


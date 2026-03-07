

## Current State: NHL-Only Parlays Already Exist

Your `nhl-floor-lock-daily` edge function **already generates pure NHL parlays** with dedicated strategy names:
- `nhl_floor_lock` — 100% L10 hit rate, execution tier
- `nhl_optimal_combo` — combinatorial 3-leg optimizer, 70%+ hit rate
- `nhl_ceiling_shot` — alt lines near L10 ceiling

These never mix with NBA legs. The only mixed strategy is `cross_sport_optimal` (NHL+MLB).

## The Actual Gap: No Independent NHL Tracking

The frontend `useDailyParlays.ts` hook treats all `bot_daily_parlays` entries identically — it doesn't distinguish NHL from NBA strategies. There's no way to see NHL-specific win rate, ROI, or performance trends.

## Plan: Add NHL Performance Tracking

### 1. Create NHL Performance Dashboard Section
**New file**: `src/components/bot/NHLPerformanceCard.tsx`
- Query `bot_daily_parlays` filtered to `strategy_name IN ('nhl_floor_lock', 'nhl_optimal_combo', 'nhl_ceiling_shot')`
- Show per-strategy: Win Rate, ROI, Total P&L, Record (W-L)
- Show overall NHL-only performance vs NBA-only and cross-sport
- Include date range (last 7 days, last 30 days, all-time)

### 2. Update `useDailyParlays.ts` — Tag NHL Parlays Distinctly
- When processing `botParlays`, detect NHL strategies by `strategy_name` prefix (`nhl_`) and tag them with a sport identifier
- Add `sport?: 'nhl' | 'nba' | 'cross'` field to `DailyParlay` interface
- Allow filtering parlays by sport in the dashboard

### 3. Update Telegram Broadcast Labeling
**Edit**: `supabase/functions/nhl-floor-lock-daily/index.ts` line 596
- Change header from `🏒 NHL + MLB DAILY PARLAYS` to `🏒 NHL-ONLY DAILY PARLAYS` for the pure NHL section
- Move cross-sport into its own labeled section so customers see NHL performance is tracked independently

### 4. Integrate Into Dashboard
**Edit**: The bot dashboard page to include the `NHLPerformanceCard` alongside existing components

### Files Changed
- **New**: `src/components/bot/NHLPerformanceCard.tsx`
- **Edit**: `src/hooks/useDailyParlays.ts` — add sport tagging
- **Edit**: `supabase/functions/nhl-floor-lock-daily/index.ts` — separate broadcast headers
- **Edit**: Bot dashboard page — mount `NHLPerformanceCard`

No database changes needed — all data already exists with the correct strategy names.


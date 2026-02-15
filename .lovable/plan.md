
# Add Whale-Backed Parlay Generation to the Bot

## What We're Building
A new strategy in the bot's parlay generator (`bot-generate-daily-parlays`) that pulls today's highest-confidence whale picks from the `whale_picks` table and builds 2-3 leg parlays from them. These will be tagged as `whale_signal` parlays and appear alongside the bot's other daily output.

## How It Works

### 1. Fetch Whale Picks as a New Candidate Pool
**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

In the main data-fetching section (around line 1620), add a query to `whale_picks`:
```typescript
const { data: whalePicks } = await supabase
  .from('whale_picks')
  .select('*')
  .eq('is_expired', false)
  .gte('sharp_score', 55)
  .gte('start_time', todayStart)
  .lte('start_time', tomorrowStart)
  .order('sharp_score', { ascending: false })
  .limit(20);
```

### 2. Convert Whale Picks to EnrichedPick Format
Map each whale pick into the same `EnrichedPick` structure the generator already uses, so the existing parlay-building machinery (fingerprinting, dedup, Monte Carlo simulation) works seamlessly:

- `player_name` from whale pick
- `prop_type` / `category` from `stat_type`
- `line` from `pp_line`
- `recommended_side` from `pick_side`
- `confidence_score` from `sharp_score / 100`
- `compositeScore` boosted by sharp_score (base 50 + sharp_score * 0.3)
- `l10_hit_rate` set to `sharp_score / 100` as a proxy (whale signal confidence)

### 3. Add Whale Strategy Profiles
Add profiles across tiers that specifically draw from the whale pick pool:

**Exploration** (2 profiles):
- `{ legs: 2, strategy: 'whale_signal', sports: ['all'] }`
- `{ legs: 3, strategy: 'whale_signal', sports: ['all'] }`

**Execution** (1 profile):
- `{ legs: 2, strategy: 'whale_signal', sports: ['all'], minHitRate: 55, sortBy: 'composite' }`

### 4. Route Whale Strategy to Whale Pool
In the parlay construction logic, when `profile.strategy` starts with `whale_signal`, the builder will draw candidates exclusively from the whale picks pool instead of the sweet spots / unified_props pool. This ensures whale parlays are built purely from sharp money signals.

### 5. Tag Whale Parlays
The generated parlays will include a `whale_signal` tag in the strategy name, making them identifiable in the bot dashboard, Telegram notifications, and settlement pipeline.

## What Stays the Same
- All existing strategies, fingerprinting, dedup, and Monte Carlo validation remain untouched
- Whale parlays go through the same simulation and quality gates as every other parlay
- Settlement works automatically since legs carry player/team identification

## Files to Edit
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- add whale pick fetching, conversion, strategy profiles, and routing logic

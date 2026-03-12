

## Bot Pipeline Explorer Page

A new `/bot-pipeline` page that shows the full decision-making process of the bot in a clean, step-by-step UI. It fetches today's `bot_daily_parlays` data and presents the pipeline as three collapsible stages, with clickable picks that expand to show detailed analysis.

### Page Structure

```text
┌─────────────────────────────────────────────┐
│  🤖 Bot Pipeline Explorer     [Mar 12, 2026]│
│  ─────────────────────────────────────────── │
│                                             │
│  STEP 1: Initial Pool                       │
│  ┌─────────────────────────────────────────┐│
│  │ All unique picks across all parlays     ││
│  │ Grouped by game • Sorted by composite   ││
│  │ [Cade Cunningham O 0.5 3PT] [98] [80%]  ││
│  │ [Luke Kennard U 12.5 PTS]   [95] [80%]  ││
│  │ ...clickable to expand details           ││
│  └─────────────────────────────────────────┘│
│                                             │
│  STEP 2: After Filters                      │
│  ┌─────────────────────────────────────────┐│
│  │ Shows which picks survived filters      ││
│  │ Tags: GRIND_BLOCK, GOD_MODE, COHERENCE  ││
│  │ Picks grouped by env cluster            ││
│  └─────────────────────────────────────────┘│
│                                             │
│  STEP 3: Final Parlays                      │
│  ┌─────────────────────────────────────────┐│
│  │ Each parlay card with strategy name     ││
│  │ Tier badge • Odds • Probability         ││
│  │ Clickable legs with full detail sheet   ││
│  └─────────────────────────────────────────┘│
│                                             │
│  CLICK A PICK → Detail Sheet:               │
│  ┌─────────────────────────────────────────┐│
│  │ Player: Cade Cunningham                 ││
│  │ Prop: O 0.5 3PT @ -110                  ││
│  │ ──────────────────────                  ││
│  │ L10 Hit Rate: 80%                       ││
│  │ Composite Score: 98                     ││
│  │ Confidence: 53%                         ││
│  │ Category: THREE_POINT_SHOOTER           ││
│  │ ──────────────────────                  ││
│  │ 🏀 Game Context                         ││
│  │ Env Cluster: SHOOTOUT (strength: 3)     ││
│  │ Defense: soft | Pace: neutral           ││
│  │ Vegas Total: 215.5                      ││
│  │ Team Total Signal: OVER (score: 65)     ││
│  │ Blowout Risk: No                        ││
│  │ ──────────────────────                  ││
│  │ 📋 Why This Pick Was Selected           ││
│  │ Strategy: shootout_stack                ││
│  │ Rationale: execution tier shootout...   ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

### Files to Create/Edit

1. **`src/pages/BotPipeline.tsx`** — New page component
   - Fetches from `bot_daily_parlays` for today's date (Eastern time)
   - Extracts all unique picks from all parlays' legs JSON
   - Presents 3 collapsible steps:
     - **Step 1 - Initial Pool**: All unique picks, grouped by game (`_gameContext.gameKey`), sorted by `composite_score`
     - **Step 2 - Filter Tags**: Same picks but with visual tags showing env cluster, defense strength, and which filters would apply (GRIND+OVER block, GOD_MODE check, coherence)
     - **Step 3 - Final Parlays**: Actual parlays grouped by tier (execution first, then exploration), showing strategy name, odds, probability, and leg count
   - Each pick is clickable → opens a Sheet with full detail

2. **`src/components/bot/PipelinePickDetail.tsx`** — Detail sheet component
   - Shows all stored leg data: player, prop, line, side, odds
   - L10 stats: hit_rate, l10_hit_rate, composite_score, confidence
   - Game context: envCluster, defenseStrength, pace, vegasTotal, teamTotalSignal, blowoutRisk
   - Which parlays this pick appears in (cross-reference)
   - Selection rationale from the parlay

3. **`src/hooks/useBotPipeline.ts`** — Data hook
   - Query `bot_daily_parlays` for today
   - Parse legs JSON, deduplicate picks by `player_name + prop_type + line + side`
   - Group by game, compute filter tag indicators
   - Auto-refetch every 60s (staleTime: 60000)

4. **`src/App.tsx`** — Add route
   - Add lazy import and `/bot-pipeline` route

### Data Available Per Pick (from legs JSON)
- `player_name`, `prop_type`, `line`, `side`, `team_name`, `sport`
- `composite_score`, `confidence_score`, `hit_rate`, `l10_hit_rate`
- `american_odds`, `category`, `type` (player/team)
- `_gameContext`: `envCluster`, `envClusterStrength`, `defenseStrength`, `pace`, `vegasTotal`, `teamTotalSignal`, `teamTotalComposite`, `blowoutRisk`, `gameKey`, `opponentAbbrev`

### Auto-Refresh
- Uses `useQuery` with `staleTime: 60000` and `refetchInterval: 60000`
- Date-aware: always shows today's Eastern date
- Empty state when no parlays generated yet

### UI Design
- Dark theme consistent with existing app (Tailwind dark classes)
- Collapsible sections using existing `Collapsible` component
- Pick detail via `Sheet` component (slide-in from right)
- Badges for tier, strategy, env cluster, defense strength
- Color coding: green = favorable, yellow = neutral, red = tough/GRIND


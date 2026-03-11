

## Smart Check Dashboard for Bot Daily Parlays

### What You Get

A new **Smart Check panel** on the DailyParlayHub that lets you manually trigger analysis engines against today's generated parlays, see results per-leg, and then press "Auto-Fix" to apply recommendations automatically.

### Flow

```text
┌─────────────────────────────────────────────────┐
│  Today's Parlays  [🔍 Smart Check ▼]  [3 Ready] │
├─────────────────────────────────────────────────┤
│  Smart Check Panel (expandable)                  │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌───────┐│
│  │ L3 Filter│ │ Blowout  │ │Injuries│ │BiDir  ││
│  │  [Run]   │ │  [Run]   │ │ [Run]  │ │[Run]  ││
│  └──────────┘ └──────────┘ └────────┘ └───────┘│
│                                                  │
│  Results:                                        │
│  ⚠️ Cade Cunningham REB OVER 8.5                │
│     L3: 7.3 (below line) | BLOWOUT -14.5        │
│     Recommendation: FLIP TO UNDER               │
│  ✅ Reed Sheppard 3PT OVER 2.5                   │
│     L3: 3.8 CONFIRMED | Spread: -3              │
│                                                  │
│  [🤖 Auto-Apply Recommendations]                │
│  (Flips sides, drops flagged legs, recalculates) │
└─────────────────────────────────────────────────┘
```

### Changes

#### 1. New Edge Function: `bot-parlay-smart-check` 

Accepts `{ checks: ['l3', 'blowout', 'injury', 'bidirectional'], parlay_ids?: string[] }`.

For each pending parlay in `bot_daily_parlays` (today):
- **L3 Check**: Query `category_sweet_spots` for each leg's L3 avg. Compare to line. Tag `L3_BELOW_LINE`, `L3_CONFIRMED`, `L3_DECLINE`.
- **Blowout Check**: Query `whale_picks` or `game_bets` for spreads. Tag `BLOWOUT_RISK` (>=10), `ELEVATED_SPREAD` (>=7) for OVER picks on favored teams.
- **Injury Check**: Query `lineup_alerts` for today. Tag `PLAYER_OUT`, `PLAYER_DOUBTFUL`, `PLAYER_QUESTIONABLE`.
- **Bidirectional Check**: Query `bot_research_findings` for matchup tier. Tag `ELITE_MATCHUP`, `AVOID_MATCHUP`, or `NO_MATCHUP_DATA`.

Returns per-leg results with risk tags and a **recommendation** per leg:
- `KEEP` — all checks pass
- `FLIP` — L3 or blowout suggests opposite side
- `DROP` — player OUT or DOUBTFUL
- `CAUTION` — questionable/elevated risk, user decides

#### 2. New Edge Function: `bot-parlay-auto-apply`

Accepts `{ actions: [{ parlay_id, leg_index, action: 'flip'|'drop'|'keep' }] }`.

- **FLIP**: Updates the leg's `side` (over↔under) in the JSONB `legs` array
- **DROP**: Removes the leg, recalculates `leg_count` and `expected_odds`
- If a parlay drops below 2 legs, auto-void it
- Logs all changes to `bot_activity_log`

#### 3. New Component: `ParlaySmartCheckPanel.tsx`

Rendered inside `DailyParlayHub.tsx` as a collapsible panel with:
- 4 individual "Run" buttons (L3, Blowout, Injury, Bidirectional) + "Run All"
- Results table showing each flagged leg with its tags and recommendation
- Checkboxes to select which recommendations to apply
- "Auto-Apply Selected" button that calls `bot-parlay-auto-apply`
- Loading/progress states per check

#### 4. Update `DailyParlayHub.tsx`

Add the SmartCheckPanel between the header and the parlay grid. Import and render `<ParlaySmartCheckPanel />`.

### Files
1. `supabase/functions/bot-parlay-smart-check/index.ts` — new edge function
2. `supabase/functions/bot-parlay-auto-apply/index.ts` — new edge function  
3. `src/components/parlays/ParlaySmartCheckPanel.tsx` — new UI component
4. `src/components/parlays/DailyParlayHub.tsx` — add SmartCheckPanel import


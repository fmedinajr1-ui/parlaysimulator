

## Customer Scout Command Center -- Full Feature Build

### Overview

Transform the customer Scout view from a basic props + hedge panel into a full command center with 5 new modules. All new features are added to `CustomerScoutView.tsx` as additional cards in the layout -- no admin tools are exposed.

### New Layout

```text
[Stream Panel]                          (existing)
[Slip Scanner]                          (NEW)
[Props + Hedge Status] (side by side)   (existing)
[Steam/Signal Overlay]                  (NEW)
[Confidence Dashboard]                  (NEW)
  - Heat meters + live hit %
  - Monte Carlo survival %
[Risk Mode Toggle]                      (NEW)
[AI Commentary Whisper]                 (NEW)
```

### Feature 1: Slip Scanner with Instant Edge Score

**New component: `src/components/scout/CustomerSlipScanner.tsx`**

- Camera/upload button that accepts a betting slip screenshot
- Calls existing `extract-parlay` edge function to extract legs
- For each extracted leg, runs:
  - CHESS EV calculator (`calculateCHESSEV` from `chess-ev-calculator.ts`) using available injury/line data
  - Kelly sizing (`calculateKelly` from `kelly-calculator.ts`) with a default $100 bankroll (user can change)
  - Quick hit probability from `category_sweet_spots` L10 hit rate lookup
- Displays an "Edge Score" card per leg showing:
  - Player + prop + line
  - Edge Score (CHESS EV normalized 0-100)
  - Kelly suggestion (e.g., "1.2% of bankroll")
  - Hit rate from sweet spots if available
  - Overall verdict: "Strong Edge" / "Thin Edge" / "No Edge"
- No raw CHESS internals shown -- just the simplified score and verdict

### Feature 2: Steam/Signal Overlay on Pick Cards

**Update: `src/components/scout/CustomerHedgeIndicator.tsx`**

- Add optional `signal` prop for whale/steam data
- Query `whale_signals` table for matching player + prop type from today
- Display small inline badges on each pick card:
  - STEAM (fire icon) -- when `signal_type = 'STEAM'`
  - FREEZE (snowflake icon) -- when `signal_type = 'FREEZE'`
  - SHARP (whale icon) -- when `signal_type = 'DIVERGENCE'`
- Only show badges, no detailed scores (those stay admin-only)

**New hook: `src/hooks/useCustomerWhaleSignals.ts`**

- Fetches today's `whale_signals` keyed by player name for quick lookup
- Returns a `Map<string, SignalType>` for the panel to use

### Feature 3: Confidence Dashboard

**New component: `src/components/scout/CustomerConfidenceDashboard.tsx`**

- Takes the enriched sweet spots and displays:
  - **Heat meter** per pick: a colored progress bar (0-100) based on hit probability derived from current pace vs line
  - **Overall slip survival %**: runs the existing `quickHybridAnalysis` from `hybrid-monte-carlo.ts` across all active picks to show "X% of 10,000 simulations survive"
  - **Live hit %**: shows `currentValue / line * 100` as a simple pace indicator
- Uses existing `Progress` component for heat bars
- Color coding: green (>70%), yellow (40-70%), red (<40%)

### Feature 4: Risk Mode Toggle

**New component: `src/components/scout/CustomerRiskToggle.tsx`**

- Three-button toggle: Conservative / Balanced / Aggressive
- Stored in local state (React context or prop drilling from CustomerScoutView)
- Affects:
  - Kelly multiplier passed to slip scanner (0.25 / 0.5 / 1.0)
  - Hedge status thresholds -- adjusts buffer by +1 / 0 / -1 on top of the progress-aware thresholds
  - Confidence dashboard coloring thresholds
- Simple toggle UI using existing `Tabs` or `ToggleGroup` component

**New context: `src/contexts/RiskModeContext.tsx`**

- Provides `riskMode` ('conservative' | 'balanced' | 'aggressive') and `setRiskMode` to all customer components
- Default: 'balanced'

### Feature 5: AI Commentary Whisper

**New component: `src/components/scout/CustomerAIWhisper.tsx`**

- Small card at the bottom that generates contextual one-liner insights
- Logic is purely client-side based on available data:
  - If a player's current pace is way above line: "LeBron is pacing at 34 pts -- well above the 24.5 line"
  - If a steam signal exists: "Sharp money detected on Giannis rebounds"
  - If hedge status changed to caution: "Keep an eye on Tatum's assists -- pace has slowed"
  - If game progress > 75% and pick is on track: "Almost there -- Jokic needs just 2 more rebounds"
- Rotates through insights every 30 seconds (carousel or single line)
- No AI API calls -- just template-driven from live data

### Changes Summary

| File | Action |
|---|---|
| `src/contexts/RiskModeContext.tsx` | Create -- risk mode provider |
| `src/components/scout/CustomerRiskToggle.tsx` | Create -- 3-mode toggle UI |
| `src/components/scout/CustomerSlipScanner.tsx` | Create -- upload + edge score |
| `src/hooks/useCustomerWhaleSignals.ts` | Create -- whale signal lookup |
| `src/components/scout/CustomerConfidenceDashboard.tsx` | Create -- heat meters + Monte Carlo survival |
| `src/components/scout/CustomerAIWhisper.tsx` | Create -- contextual insight carousel |
| `src/components/scout/CustomerHedgeIndicator.tsx` | Update -- add signal badges |
| `src/components/scout/CustomerHedgePanel.tsx` | Update -- pass whale signals to indicators |
| `src/components/scout/CustomerScoutView.tsx` | Update -- compose all new panels into layout |
| `src/pages/Scout.tsx` | Update -- wrap customer view in RiskModeContext |

### Technical Notes

- All new components use existing data sources (sweet spots, whale signals, category sweet spots) -- no new edge functions needed except the existing `extract-parlay`
- CHESS EV and Kelly calculations run client-side using existing utility functions
- Monte Carlo uses the lightweight `quickHybridAnalysis` (not the full 100K simulation) for performance
- Risk mode is local state only -- no database persistence needed
- Whale signal query is filtered to today's date with 60s stale time


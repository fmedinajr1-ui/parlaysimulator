

## Scout Live: War Room Edition -- Phase 1

This is a large transformation of the Customer Scout View from a basic data dashboard into an immersive, Bloomberg-terminal-style war room. Given the scope, I'm breaking this into a focused Phase 1 that delivers the highest-impact visual and functional upgrades.

### What Already Exists (Reusable)

- Half-court SVG Shot Chart (`ShotChartMatchup.tsx`) -- zone-based matchup visualization
- Fatigue system (`FatigueMeter.tsx`, `useFatigueData.ts`) -- team-level fatigue scores
- Live scoreboard with animated score changes (Framer Motion)
- Box score table with player stats
- Hedge panel with ON TRACK / CAUTION / ACTION NEEDED tiers
- Confidence dashboard with progress bars
- Risk mode toggle (Conservative / Balanced / Aggressive)
- AI Whisper commentary rotation
- Unified live feed hook (`useUnifiedLiveFeed`) with player projections
- Slip scanner with CHESS EV scoring

### What Phase 1 Builds

**1. War Room Layout Overhaul (`CustomerScoutView.tsx`)**
- Replace the current vertical card stack with a dark, premium War Room layout
- Deep black background (#0B0F1A) with glass-effect cards (rgba(255,255,255,0.04))
- Subtle grain texture overlay via CSS
- Neon accent color system: Green = +EV, Gold = Hedge, Blue = Regression, Red = Risk
- Game Mode / Hedge Mode toggle at the top (replaces Risk Toggle position)

**2. Enhanced Hero Section (`CustomerLiveGamePanel.tsx`)**
- Add pace differential display (pull from `useUnifiedLiveFeed` game pace)
- Add momentum indicator: animated arrow that flashes and changes direction when lead changes
- Subtle glow behind leading team's score
- Integrate mini shot chart into the hero section (reuse existing `ShotChartMatchup` in compact mode)

**3. Smart Prop Cards (`WarRoomPropCard.tsx` -- NEW)**
- Replace the flat Sweet Spot Props list with rich interactive cards
- Each card includes:
  - Live progress bar (current value vs line)
  - Pace adjustment percentage
  - AI confidence percentage (from projection data)
  - Circular fatigue ring indicator (Green 0-40%, Yellow 40-70%, Red 70-100%)
  - Regression status badge (snowflake icon for cold, fire for hot streak)
  - Hedge alert icon with gold border glow when opportunity detected
- Animation rules: gold border glow for hedge opportunity, red shimmer for high fatigue, blue ice shimmer for cold regression

**4. AI Fatigue Ring Component (`FatigueRing.tsx` -- NEW)**
- Circular SVG ring meter (not a bar) for per-player fatigue
- Color transitions: Green -> Yellow -> Red based on fatigue percentage
- Fatigue calculation using: `(minutes_played x pace_factor x usage_rate) / conditioning_index`
- Sources data from `useUnifiedLiveFeed` (minutes played, pace) combined with `useFatigueData` (team-level fatigue)
- Pulse animation when fatigue exceeds 75%
- Tooltip: "Projected efficiency drop: -X%"

**5. Cold Regression Detection (`useRegressionDetection.ts` -- NEW hook)**
- Detect when a player's current output is significantly below or above their expected rate
- Formula: `regression_score = (expected - actual) / shot_quality_factor x variance_adjustment`
- Uses projection data from `useUnifiedLiveFeed` to compare current vs projected
- Triggers visual badges on prop cards:
  - Blue ice glow + snowflake for cold regression (positive regression likely = suggest Over)
  - Red fire glow for hot regression (negative regression likely = suggest Under)
- Threshold: regression probability > 65% triggers alert

**6. Live Hedge Slide-In Alerts (`HedgeSlideIn.tsx` -- NEW)**
- Animated slide-in panel from the right side (Framer Motion)
- Triggers when: `|live_projection - live_line| > edge_threshold AND volatility < max_volatility`
- Shows: player name, prop, live projection, live line, edge size, Kelly suggestion
- Buttons: "Hedge Now" (opens sportsbook deep link if available) and "Dismiss"
- Auto-calculates: suggested hedge stake %, risk reduction %, EV %
- Gold neon accent styling

**7. Hedge Mode View (`HedgeModeTable.tsx` -- NEW)**
- When toggled to Hedge Mode, replace prop cards with a dense table view:
  - Columns: Prop | Current | Live Line | Projection | Edge | Suggested Hedge
  - Row animations: green flicker on positive changes, red on negative
- Reuses data from `useUnifiedLiveFeed` and existing hedge utilities

**8. Advanced Metrics Panel (Collapsible)**
- Expandable panel at the bottom with:
  - Monte Carlo simulation win % (reuse existing `monte-carlo.ts`)
  - Blowout risk % (from unified feed game score differential)
  - Fatigue impact %
  - Regression probability %
- Uses `Collapsible` component (already exists)

### Technical Details

**Files created:**
- `src/components/scout/warroom/WarRoomLayout.tsx` -- main War Room container with dark theme
- `src/components/scout/warroom/WarRoomPropCard.tsx` -- smart prop card with all indicators
- `src/components/scout/warroom/FatigueRing.tsx` -- circular SVG fatigue indicator
- `src/components/scout/warroom/HedgeSlideIn.tsx` -- animated slide-in hedge alert
- `src/components/scout/warroom/HedgeModeTable.tsx` -- dense hedge comparison table
- `src/components/scout/warroom/MomentumIndicator.tsx` -- animated momentum arrow
- `src/components/scout/warroom/AdvancedMetricsPanel.tsx` -- collapsible Monte Carlo panel
- `src/hooks/useRegressionDetection.ts` -- cold/hot regression detection hook

**Files modified:**
- `src/components/scout/CustomerScoutView.tsx` -- replace with War Room layout
- `src/components/scout/CustomerLiveGamePanel.tsx` -- add momentum indicator, pace diff, mini shot chart
- `src/index.css` -- add War Room CSS variables and grain texture overlay

**Data flow:**
- `useUnifiedLiveFeed` provides: player minutes, stats, projections, pace, game progress
- `useFatigueData` provides: team-level fatigue scores
- `useSweetSpotLiveData` provides: live hedge status, projected final, pace rating
- `useRegressionDetection` (new) computes: regression scores from projection vs actual
- No new edge functions needed -- all data sources already exist

**Design tokens added to CSS:**
```text
--warroom-bg: #0B0F1A
--warroom-card: rgba(255, 255, 255, 0.04)
--warroom-green: #00ff8c (EV positive)
--warroom-gold: #ffd700 (hedge opportunity)
--warroom-ice: #00d4ff (regression)
--warroom-danger: #ff4444 (risk)
```

### Not in Phase 1 (Future)

- AI Voice Alerts (ElevenLabs TTS) -- Phase 2
- Individual shot tracking with made/missed animations -- Phase 2 (needs play-by-play data source)
- Hot Streak Mode (3 consecutive shots detection) -- Phase 2 (needs shot-level events)
- Defender distance / shot quality tooltips -- Phase 2 (needs tracking data)


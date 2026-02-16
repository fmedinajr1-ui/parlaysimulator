

# Add Shadow Picks Tab to Bot Dashboard

## Overview

Add a new "Simulation" tab to the Bot Dashboard that shows shadow picks from the simulation engine, accuracy stats per sport, and a button to trigger new predictions.

---

## What You'll See

- A new **5th tab** labeled "Simulation" on the Bot Dashboard (next to Overview, Parlays, Analytics, Research)
- **Accuracy Summary Cards**: One card per sport showing hit rate, total picks, and a "production ready" badge when accuracy exceeds threshold
- **Shadow Picks Feed**: A scrollable list of all shadow picks showing sport, matchup (home vs away), bet type, side, line, predicted score, odds, and outcome (pending/won/lost)
- **Filter Controls**: Filter by sport, outcome (pending/settled), and bet type
- **Run Simulation Button**: Triggers the simulation engine's predict mode directly from the dashboard
- An empty state message when no shadow picks exist yet, with a prompt to run the simulation engine

---

## Components to Create

### 1. `src/components/bot/SimulationAccuracyCard.tsx`
- Fetches from `simulation_accuracy` table
- Shows per-sport accuracy as progress bars with hit rate percentage
- Green "Production Ready" badge when `is_production_ready = true`
- Red "Simulating" badge otherwise
- Shows total predictions made and correct count

### 2. `src/components/bot/ShadowPicksFeed.tsx`
- Fetches from `simulation_shadow_picks` ordered by `created_at desc`, limit 50
- Each pick rendered as a compact card showing:
  - Sport icon/badge
  - Matchup: home_team vs away_team
  - Bet type + side + line (e.g., "Total OVER 145.5")
  - Predicted composite score with color coding (green >= 80, amber >= 60, red < 60)
  - Odds in American format
  - Outcome badge: pending (gray), won (green), lost (red)
- Filter bar at top: sport dropdown, outcome tabs (All/Pending/Won/Lost)
- "Run Simulation" button that calls `odds-simulation-engine` with `mode: 'predict'`

### 3. Update `src/pages/BotDashboard.tsx`
- Add "Simulation" tab trigger and content
- Import the two new components
- Place accuracy cards at top, shadow picks feed below

---

## Technical Details

### Data Fetching

Both components use direct Supabase queries (no hook refactor needed):

```typescript
// Shadow picks
const { data } = await supabase
  .from('simulation_shadow_picks')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(50);

// Accuracy stats
const { data } = await supabase
  .from('simulation_accuracy')
  .select('*')
  .order('accuracy_rate', { ascending: false });
```

### Run Simulation Action

Calls the existing edge function:
```typescript
const { data } = await supabase.functions.invoke('odds-simulation-engine', {
  body: { mode: 'predict' }
});
```

### Files Modified
- `src/pages/BotDashboard.tsx` -- add Simulation tab

### Files Created
- `src/components/bot/SimulationAccuracyCard.tsx`
- `src/components/bot/ShadowPicksFeed.tsx`

### No Database Changes Required
Both tables already exist with public read RLS policies.


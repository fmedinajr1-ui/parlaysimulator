

## Prop Intelligence Engine v1 — Upgrade Plan

### What Already Exists

Your War Room already has significant infrastructure in place:

| Feature | Status | Current Location |
|---------|--------|-----------------|
| Live prop cards with player/line/projected | Built | `WarRoomPropCard.tsx` |
| Regression detection (hot/cold) | Built | `useRegressionDetection.ts` |
| Fatigue ring + fatigue scores | Built | `FatigueRing.tsx`, `useFatigueData.ts` |
| Live projections with role-based rates | Built | `useLiveProjections.ts` |
| Hedge slide-in alerts | Built | `HedgeSlideIn.tsx` |
| Hedge mode table (LOCK/HOLD/MONITOR/EXIT) | Built | `HedgeModeTable.tsx` |
| Advanced metrics panel (blowout, fatigue, regression, Monte Carlo bars) | Built | `AdvancedMetricsPanel.tsx` |
| Dark theme with neon accents | Built | War Room CSS variables |
| Game strip selector | Built | `WarRoomGameStrip.tsx` |
| Live score polling (8s via ESPN) | Built | `fetch-live-pbp` edge function |

### What Needs to Be Built or Upgraded

The prompt specifies several calculation improvements and new UI elements that go beyond the current implementation.

---

### Phase 1: Enhanced Calculation Engine (Hook Upgrades)

**File: `src/hooks/useLiveProjections.ts`**

Upgrade the projection math to match the prompt's formulas:

- **Live Blend Rate**: Replace current fixed blending weights with the prompt's formula: `w = minutes / (minutes + 12)`, then `r_blend = (1-w)*baseline + w*live_rate`. Currently uses a `0.35 + progress*0.5` weight that doesn't match.
- **Pace Multiplier**: Add `pace_mult = team_possessions_1H / avg_pace_L10` scaling to the blended rate. Currently pace is not factored into projection math.
- **Volatility Model (Z-Score)**: Add standard deviation tracking and Normal CDF calculation: `sigma_rem = std_per_min * sqrt(min_remaining)`, `Z = (line - projected) / sigma_rem`, `P_over = 1 - NormalCDF(Z)`. Currently no probability calculation exists in projections.
- **Edge Score**: Add `EdgeScore = (P_over - ImpliedProb) * 100` using odds from `unified_props`. Currently no edge score on live cards.

**New file: `src/lib/normalCdf.ts`** — Small utility for the standard normal CDF approximation.

**New file: `src/hooks/useMinutesStability.ts`** — Track minutes variance across L10 games from `nba_player_game_logs` to produce a `minutes_stability_index` (0-100). Query L10 minutes, calculate coefficient of variation, convert to 0-100 scale.

---

### Phase 2: Regression Engine Upgrade

**File: `src/hooks/useRegressionDetection.ts`**

Add the prompt's stat-specific regression rules:

- **Points**: If shot attempts exceed 120% of L10 pace, boost projection 5%. If shooting percentage is above L10 on low volume, reduce 5%.
- **Rebounds**: Use opponent missed FG multiplier (opponent FG misses in 1H vs average).
- **Assists**: Use teammate FG% regression and potential assists pace.
- **PRA Combo**: Sum means, combine variance as `sigma_PRA = sqrt(sigma_P^2 + sigma_R^2 + sigma_A^2)`.

This requires pulling L10 shooting data from `nba_player_game_logs` (already cached in React Query) and opponent FG data from live box scores.

---

### Phase 3: Upgraded Prop Card UI

**File: `src/components/scout/warroom/WarRoomPropCard.tsx`**

Add new visual elements to each card:

- **Edge Score Badge** — colored badge showing `+X.X%` edge, green/amber/red.
- **P_over / P_under** — two small probability percentages displayed side by side.
- **Pace Meter** — small animated horizontal bar showing pace_mult relative to 1.0 (green if above, red if below).
- **Minutes Stability Bar** — thin progress bar (0-100) showing consistency.
- **Foul Risk Indicator** — small text label (Low/Med/High) based on current fouls.

Update `WarRoomPropData` interface to include: `pOver`, `pUnder`, `edgeScore`, `minutesStabilityIndex`, `foulRisk`.

---

### Phase 4: Monte Carlo Toggle

**File: `src/components/scout/warroom/AdvancedMetricsPanel.tsx`**

Add a toggle switch in the Advanced Metrics panel:

- **OFF (default)**: Use analytic Normal CDF approximation for P_over (fast).
- **ON**: Run 10,000 simulations per prop using `projected_stat` and `sigma_rem` as the normal distribution parameters. Return empirical P_over.

**New file: `src/lib/monteCarlo.ts`** — Function that takes `(mean, stdDev, line, simCount=10000)` and returns empirical probability. Runs in a `useMemo` or web worker to avoid UI freezing.

The toggle state flows down to `WarRoomLayout` which passes it to the projection hook.

---

### Phase 5: Live Alert System Upgrade

**File: `src/components/scout/warroom/HedgeSlideIn.tsx`**

Add new trigger conditions beyond current hedge-only alerts:

- EdgeScore flips sides (was positive, now negative or vice versa) — tracked via history in `useLiveProjections`.
- Spread changes greater than 5 points live (compare initial spread to current from live data).
- Player role change detected (minutes share drops significantly mid-game).

Each alert type gets a distinct color/icon: gold for hedge, blue for edge flip, red for role change.

---

### Phase 6: Intelligence Flags on Every Prop

**File: `src/hooks/useLiveProjections.ts`** (return object)

Add these computed flags to every `LiveProjection`:

- `pace_rating`: "green" / "yellow" / "red" based on pace_mult thresholds.
- `regression_signal`: "hot" / "cold" / "neutral" from regression engine.
- `minutes_stability_index`: 0-100 from the new hook.
- `fatigue_flag`: boolean from fatigue data.
- `foul_risk`: "low" / "medium" / "high" based on current fouls.
- `hedge_signal`: boolean when edge flips or margin is thin.

---

### Technical Summary

| Change | File(s) | Complexity |
|--------|---------|------------|
| Blend rate + pace multiplier formula | `useLiveProjections.ts` | Medium |
| Volatility model + P_over/P_under | `useLiveProjections.ts` + new `normalCdf.ts` | Medium |
| Edge score calculation | `useLiveProjections.ts` | Low |
| Minutes stability hook | New `useMinutesStability.ts` | Low |
| Regression engine stat-specific rules | `useRegressionDetection.ts` | Medium |
| Prop card UI additions (edge badge, pace meter, probabilities) | `WarRoomPropCard.tsx` | Medium |
| Monte Carlo toggle + simulation | New `monteCarlo.ts` + `AdvancedMetricsPanel.tsx` | Medium |
| Alert system upgrade (edge flip, spread change, role change) | `HedgeSlideIn.tsx` + `WarRoomLayout.tsx` | Medium |
| Intelligence flags on projection output | `useLiveProjections.ts` | Low |

### Build Order

1. `normalCdf.ts` utility (no dependencies)
2. `monteCarlo.ts` utility (depends on #1)
3. `useMinutesStability.ts` hook (independent)
4. `useLiveProjections.ts` upgrades (depends on #1, #3)
5. `useRegressionDetection.ts` upgrades (independent)
6. `WarRoomPropCard.tsx` UI additions (depends on #4, #5)
7. `AdvancedMetricsPanel.tsx` Monte Carlo toggle (depends on #2)
8. `HedgeSlideIn.tsx` + `WarRoomLayout.tsx` alert upgrades (depends on #4)

### No Database Changes Required

All new calculations are client-side using existing data from `nba_player_game_logs`, `unified_props`, and live ESPN feed. No new tables or edge functions needed.


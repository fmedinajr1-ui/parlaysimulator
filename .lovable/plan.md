

## Prop Intelligence Engine v1 — IMPLEMENTED ✅

### Build Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Enhanced Calculation Engine | ✅ Done |
| Phase 2 | Regression Engine Upgrade | ✅ Done |
| Phase 3 | Upgraded Prop Card UI | ✅ Done |
| Phase 4 | Monte Carlo Toggle | ✅ Done |
| Phase 5 | Live Alert System Upgrade | ✅ Done |
| Phase 6 | Intelligence Flags | ✅ Done |

### Files Created
- `src/lib/normalCdf.ts` — Standard Normal CDF, P_over, Edge Score, American odds conversion
- `src/lib/propMonteCarlo.ts` — Box-Muller MC simulation for empirical P_over
- `src/hooks/useMinutesStability.ts` — L10 minutes variance → stability index (0-100)

### Files Upgraded
- `src/hooks/useLiveProjections.ts` — New blend formula (w=min/(min+12)), pace multiplier, volatility model (σ_rem), P_over/P_under, Edge Score, intelligence flags
- `src/hooks/useRegressionDetection.ts` — Stat-specific rules for Points (shot attempts/%), Rebounds (opponent FG), Assists (team efficiency), adjustmentPct field
- `src/components/scout/warroom/WarRoomPropCard.tsx` — Edge Score badge, P(O)/P(U) display, Pace Meter (animated), Minutes Stability bar, Foul Risk indicator
- `src/components/scout/warroom/AdvancedMetricsPanel.tsx` — Monte Carlo toggle (Analytic ↔ 10K Sims)
- `src/components/scout/warroom/HedgeSlideIn.tsx` — Multi-type alerts (hedge/edge_flip/role_change/spread_shift) with distinct colors/icons
- `src/components/scout/warroom/WarRoomLayout.tsx` — Minutes stability hook wiring, MC toggle state management

### Future Enhancements
- Wire live pace data (team_possessions_1H / avg_pace_L10) into paceMult when available from ESPN feed
- Connect odds from unified_props to edgeScore calculation via oddsMap
- Add web worker for Monte Carlo to prevent any UI blocking on lower-end devices
- PRA combined variance model (σ_PRA = sqrt(σ_P² + σ_R² + σ_A²)) when individual stat projections are tracked simultaneously

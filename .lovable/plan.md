
## Live Line Scanner Implementation

### Summary
Implementing a "Line Timing" layer for Lock Mode that scans live book lines, compares them to projections, and shows BET_NOW / WAIT / AVOID signals for each leg.

### Files to Create/Modify

1. **Create `src/hooks/useLockModeLineScanner.ts`** - New hook for live line scanning
2. **Modify `src/types/scout-agent.ts`** - Add LineStatus types 
3. **Modify `src/lib/lockModeEngine.ts`** - Add Line Fit calculation functions
4. **Modify `src/components/scout/LockModeTab.tsx`** - Integrate line scanner
5. **Modify `src/components/scout/LockModeLegCard.tsx`** - Show live line + status

### Technical Details

**New Types:**
- `LineTimingStatus`: 'BET_NOW' | 'WAIT' | 'AVOID' | 'LOADING'
- `LineStatus`: Tracks live line, movement, fit score, status, and reasons
- `LineFitResult`: Score calculation result with status

**Line Fit Scoring Logic:**
- Calculate edge vs live line vs original line
- Score based on how favorable the current book line is
- Detect trap lines (edge > 5 or rapid movement)

**Scan Strategy:**
- 30-second interval (configurable)
- Batch fetch all 3 legs in parallel using `fetch-current-odds`
- Game-state aware (only scan when slip is valid)

**UI Enhancements:**
- Live line display with movement indicator (↑/↓)
- BET_NOW (green), WAIT (amber), AVOID (red) badges
- Slip header shows overall readiness status
- Last scan timestamp with refresh indicator

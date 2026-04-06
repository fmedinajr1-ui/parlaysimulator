

# Fix Directional Logic: Line Dropping = UNDER, Line Rising = OVER

## Problem
Currently, for player prop signals (take_it_now, velocity_spike, line_about_to_move, cascade), the system uses **contrarian logic**: line dropping → recommend OVER. The user confirms this is wrong — when a line drops 1-2 points, the market is telling you it should be UNDER. The system should **follow the market movement** for these signals, not fade it.

**Current (wrong) logic for player props:**
- Line dropping → OVER ("grab value before it drops more")
- Line rising → UNDER ("grab value before it rises more")

**Correct logic:**
- Line dropping → UNDER (market says player will underperform)
- Line rising → OVER (market says player will overperform)

Note: Team markets (totals, spreads, moneyline) already have correct directional logic in most places. Snapback signals use regression-to-mean logic which is intentionally different and stays as-is.

## Changes

### File 1: `supabase/functions/fanduel-behavior-analyzer/index.ts`

**A. Fix actionSide assignment (~line 1031-1042)**
- `take_it_now`: dropping → UNDER (was OVER)
- `velocity_spike` / `line_about_to_move`: dropping → UNDER (was OVER)
- `snapback`: no change (regression logic is correct)
- `team_news_shift`: no change (already correct)
- `correlated_movement`: flip to follow market — dropping → UNDER (was OVER as "fade")

**B. Fix Telegram formatters for each signal type:**

1. **Take It Now (~line 1127-1130)**: Player prop action flipped:
   - dropping → `UNDER {line}` with reason "Line dropping = sharp money on under"
   - rising → `OVER {line}` with reason "Line rising = sharp money on over"

2. **Velocity Spike (~line 1171-1174)**: Same flip:
   - dropping → `UNDER` with reason "Line consistently dropping = sharps expecting under"
   - rising → `OVER` with reason "Line consistently rising = sharps expecting over"

3. **Line About To Move (~line 1218-1221)**: Same flip:
   - dropping → `UNDER` with reason "Line dropping = market expects fewer"
   - rising → `OVER` with reason "Line rising = market expects more"

4. **Correlated Movement (~line 1310-1315)**: Flip to follow market like team_news_shift

**C. Fix predictionText (~line 1013-1016)**: Default prediction direction for standard signals flipped to match.

### File 2: `supabase/functions/fanduel-prediction-alerts/index.ts`

**A. Fix rawSide (~line 652)**:
- Change `lineDiff < 0 ? "OVER" : "UNDER"` → `lineDiff < 0 ? "UNDER" : "OVER"`

**B. Remove or invert CONTRARIAN_PROPS logic (~line 44, 651-653)**:
- The contrarian flip for player_points and player_threes currently double-inverts (dropping → OVER → flipped to UNDER). With the base logic now correct (dropping → UNDER), the contrarian flip would wrongly make it OVER again. Remove the CONTRARIAN_PROPS flip entirely since the base direction is now correct.

**C. Fix cascade auto-flip (~line 690-694)**:
- Currently flips cascade OVER → UNDER. With the new base logic (dropping → UNDER already), this auto-flip would wrongly flip UNDER → OVER. Remove or adjust this cascade flip.

**D. Update reason text (~line 727-733)**:
- "Line dropping = sharp money expects under" instead of "value is OVER"

## What Stays The Same
- **Snapback** signals: regression-to-mean logic (above open → UNDER, below open → OVER) is conceptually different and stays as-is
- **Team market totals**: already correct (dropping → UNDER)
- **Moneyline/H2H/Spreads**: team-level logic unchanged
- **Alt line buffer system**: no change (buffers are applied based on the action side, which will now be correct)
- **Minutes volatility gate**: unchanged

## Scope
- 2 edge function files modified
- No migration needed
- Directional logic only — no new features


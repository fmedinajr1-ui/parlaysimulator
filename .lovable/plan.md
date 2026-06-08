## Goal
Stop hardcoding "NBA" in 3 frontend surfaces so MLB and Tennis render correctly.

## Changes (frontend-only, presentation)

### 1. `src/components/results/SharpMoneyAlerts.tsx`
- Replace the NBA-only fatigue gate (`alert.sport !== 'basketball_nba'`) with a sport-aware label resolver that maps `alert.sport` → display string:
  - `basketball_nba` → `NBA`
  - `baseball_mlb` → `MLB`
  - `tennis_*` (atp/wta) → `Tennis`
  - fallback → existing raw value
- Keep fatigue badge logic but allow MLB/Tennis (no fatigue scores → simply skip badge instead of bailing the whole card to NBA branding).
- Show the resolved sport label in the existing `<Badge>{alert.sport}</Badge>` slot.

### 2. `src/components/pools/SubmitLegModal.tsx`
- Replace default `useState('NBA')` and reset `setSport('NBA')` with a derived default driven by today's active sport (MLB in season → "MLB", else Tennis → "Tennis", else "NBA").
- Add `MLB` and `Tennis` `<SelectItem>`s to the sport dropdown so users can submit non-NBA legs.

### 3. `src/components/team-bets/TeamBetsDashboard.tsx`
- Extend `SPORTS` array to include `'MLB'` and `'TENNIS'`.
- Add mapping entries:
  - display → key: `'MLB' → 'baseball_mlb'`, `'TENNIS' → 'tennis_atp'`
  - key → display: `'baseball_mlb' → 'MLB'`, `'tennis_atp' → 'TENNIS'`, `'tennis_wta' → 'TENNIS'`
- Update the default-sport effect: prefer the sport with the most games today instead of forcing NBA when NCAAB is empty. Falls back to NBA only if no other sport has games.

## Out of scope
- Backend / edge functions (already FanDuel-gated).
- `TrapFavoriteAlert` (NBA/NFL-only by design — trap-favorite model doesn't run for MLB/Tennis).
- Admin-only panels (`SharpLineCalculator`, `BulkSlipUpload`) — those are operator tools, not user-facing.

## Verification
1. Load `/` with an MLB sharp alert in `line_movements` → badge reads "MLB", not "basketball_mlb" or "NBA".
2. Load `/` with a tennis sharp alert → badge reads "Tennis".
3. Open Submit Leg modal during MLB season → default sport is MLB; dropdown lists MLB + Tennis.
4. Open `/team-bets` on a day with MLB games only → dashboard defaults to MLB tab, not NBA.
5. Switch TeamBets tab to TENNIS → tennis_atp + tennis_wta games both appear.

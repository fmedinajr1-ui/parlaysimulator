

## Plan: Fix High Roller & Mega Jackpot Lottery Tiers

### Problem
- **First Basket legs** have ~0.64% cumulative probability when doubled — nearly impossible to win
- **DD legs** lack L10 validation — blanket 40% hit rate applied without checking recent performance
- **Exposure cap** (`allUsedPlayers`) not enforced in Mega Jackpot `passesBasicChecks` calls
- **No statistical grounding** — HR/Mega tickets can be 100% exotic/team bets with zero L10-backed player props

### Changes (all in `supabase/functions/nba-mega-parlay-scanner/index.ts`)

#### 1. Replace First Basket with High-Odds Player Props
- Remove `player_first_basket` from allowed markets in HR and Mega tiers
- Keep it defined in `EXOTIC_PLAYER_MARKETS` (for future use) but filter it out during candidate selection for these tiers
- HR/Mega will instead fill those slots with player props at +200-400 odds that have actual L10 data
- Specifically: add filter `if (p.prop_type === 'player_first_basket') return false` in both HR candidates (line ~1060) and Mega candidates (line ~1141)

#### 2. Require L10 Data for DD Selections
- In the DD scoring section (line ~634-656), add a gate: if `prop_type === 'player_double_double'`, require that the player has L10 data from `gameLogMap` with `l10_avg` in at least one category (points, rebounds, assists)
- If no L10 data exists for the player, skip the DD pick entirely (`continue`)
- This replaces the blanket 40% hit rate with actual performance data

#### 3. Apply Exposure Cap to All Tiers
- The HR candidates filter (line ~1065) and Mega candidates filter (line ~1148) already check `allUsedPlayers` 
- BUT the `passesBasicChecks` function doesn't check `allUsedPlayers` — it only checks `excludeSet` (line 909)
- Fix: add `allUsedPlayers` check inside `passesBasicChecks` by passing it as a parameter, OR add the check in the HR/Mega candidate loops before `addLeg`
- Simpler approach: add `if (allUsedPlayers.has(normalizeName(c.player_name))) continue;` in the HR loop (line ~1074) and Mega R2 loop (line ~1207) — the filter already has it but the loop re-checks `passesBasicChecks` which may pass stale data. Also add to relaxed fallback passes.

#### 4. Require At Least One L10-Backed Player Prop Per Ticket
- After building HR legs (before line ~1106): check if at least 1 leg has `market_type === 'player_prop'` AND `l10Avg !== null`. If not, force-add the best available player prop with L10 data
- Same logic for Mega (before line ~1244)
- This ensures every ticket has statistical grounding, not just exotic/team bet combos

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/nba-mega-parlay-scanner/index.ts` | All 4 fixes |


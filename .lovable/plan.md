## Plan: Fix High Roller & Mega Jackpot Lottery Tiers — IMPLEMENTED ✅

### Changes Applied

1. **First Basket blocked** — `player_first_basket` filtered out of HR candidates, HR relaxed fallback, Mega candidates, and Mega relaxed filler. Kept in `EXOTIC_PLAYER_MARKETS` for future use.

2. **DD L10 validation** — DD picks now require L10 data in points/rebounds/assists. Hit rate calculated from actual averages (45% if 2+ categories ≥10, 30% if near-DD, 10% otherwise) instead of blanket 40%.

3. **Global exposure cap enforced** — `allUsedPlayers` check added in HR main loop, HR relaxed fallback, Mega R1 loop, Mega R2 loop, and Mega relaxed filler to prevent duplicate players across tickets.

4. **L10 anchor leg required** — After building HR/Mega legs, system checks for at least 1 `player_prop` with `l10Avg !== null`. If missing, force-adds the best available L10-backed player prop as an anchor.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/nba-mega-parlay-scanner/index.ts` | All 4 fixes |

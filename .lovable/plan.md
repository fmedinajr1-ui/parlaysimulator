## Plan: Safer Alt Lines for Under Plays (Ghost Line Fallback) — IMPLEMENTED ✅

### Changes Applied

1. **Alt line fetch expanded** — Under threes candidates (L10 median ≥ line + 1) now included in alt line API calls alongside volume candidates, deduped by player+prop.

2. **Under-side alt line swap** — After over-side alt swaps, a new loop processes all under picks: finds higher lines with underOdds between -130 and -250, picks the lowest viable alt, applies +3 composite bonus.

3. **Ghost line fallback** — When no real alt lines exist for threes unders with L10 median ≥ line + 1: bumps line +1.0, applies -40 odds penalty, tags `ghost_alt: true` for tracking.

4. **Leg serialization updated** — `alt_swapped` and `ghost_alt` flags included in parlay leg JSON for Telegram reports and settlement tracking.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/nba-mega-parlay-scanner/index.ts` | All four changes |

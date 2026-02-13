
# Smarter Team Moneyline Strategy

## The Problem
Team moneyline parlays are currently **0-8** (with 2 voids). The losses come from:
- Picking obscure NCAAB teams (IUPUI, Binghamton, Maine) that lack reliable data
- Mixing too many ML legs together (3-4 ML picks per parlay = very low combined probability)
- No odds-value filtering -- heavy favorites offer low value, underdogs bust too often
- Composite scores not being enforced strongly enough (current floor is rank 150)

## The Solution: "ML Sniper" Approach

Instead of removing moneyline entirely, restructure it to be surgical:

### Change 1: Restrict ML to Top-Tier Teams Only
- Tighten the NCAAB ML gate from rank 150 to **rank 50** -- only allow Top 50 KenPom teams on moneyline
- For NBA, require the team to be a home favorite with odds between -110 and -300 (sweet spot -- not too heavy, not a coin flip)

### Change 2: Limit ML Legs Per Parlay to 1
- Never build a pure 3-leg ML parlay again -- those are the ones going 0-8
- Instead, allow **at most 1 ML leg** mixed into spread/total parlays as a "confidence anchor"
- This keeps ML exposure while preventing compound failure

### Change 3: Add Odds-Value Gate
- Block ML picks with implied probability above 85% (too much juice, not enough value)
- Block ML underdogs with implied probability below 30% (too risky for parlays)
- Sweet spot: 35-75% implied probability range

### Change 4: Replace Pure ML Profiles with Hybrid Profiles
- Remove the dedicated `team_ml` and `team_ml_cross` profiles from exploration tier
- Replace with `team_hybrid` profiles that mix 1 ML leg + 2 spread/total legs
- Keep the cross-sport concept but enforce the 1-ML-max rule

## Technical Details

### File: `supabase/functions/bot-generate-daily-parlays/index.ts`

**Profile changes (lines 94, 102):**
- Replace `team_ml` profile with `team_hybrid` that has `betTypes: ['moneyline', 'spread', 'total']` and a new `maxMlLegs: 1` constraint
- Replace `team_ml_cross` with `team_hybrid_cross` using the same `maxMlLegs: 1` rule

**NCAAB ML gate (lines 1947-1956):**
- Tighten rank gate from 150 to 50
- Add odds range filter: block picks outside -110 to -300 for favorites, +150 to +350 for underdogs

**NBA ML filter (new, near line 1960):**
- Add NBA-specific gate: only allow home favorites between -110 and -300
- Block all NBA road ML picks (away ML is historically volatile)

**Parlay assembly (near line 2060):**
- For `team_hybrid` and `team_hybrid_cross` profiles, add logic to cap ML legs at 1 per parlay
- Sort candidates so the highest-composite ML pick is selected first, then fill remaining legs with spreads/totals

**Composite score floor for ML:**
- Raise minimum composite score for moneyline picks from 62 to **70** -- only the strongest ML signals get through

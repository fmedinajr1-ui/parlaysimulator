---
name: Team & MLB market expansion
description: parlay-engine-v2 ingests team markets (ML/spread/total) and 17 MLB player props directly from unified_props via buildExtraCandidates
type: feature
---
- unified_props.market_type in {player, moneyline, spread, total}
- team-markets-sync: NBA/MLB/NHL/NFL h2h+spreads+totals every 15m
- mlb-odds-props-sync: 17 markets every 20m
- Engine buildExtraCandidates emits both sides; Moneyline & Spread use HOME/AWAY (spread away line = -home line); Total uses OVER/UNDER
- parlayNoConflictingLegs keys team legs on unordered matchup + prop_type to block same-game HOME+AWAY pairs
- direct-pick-sources raw_props fallback filters market_type to player only

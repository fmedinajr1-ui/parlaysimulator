---
name: cross-sport-generator
description: Bulk cross-sport parlay generator pulling MLB/NHL/NBA/NCAAB/NCAAF candidates with Perplexity research boost; player-primary with team legs capped at 40%
type: feature
---

- Pipeline: `cross-sport-parlay-research` (09:30 ET, Perplexity sonar-pro per active sport)
  → `cross-sport-sweet-spots` (09:45 ET) → `cross-sport-parlay-generator` (10:00 ET).
- Leg formula: `safety = 0.45*l10_hit + 0.20*floor_margin + 0.15*median_margin
  + 0.10*line_edge + 0.10*research_boost`. Tier cuts: lock 0.80 / strong 0.70 / lean 0.60.
- Team legs use dejuiced implied prob + structural bump (HOME ML +0.04, HOME spread +0.03,
  UNDER total +0.02), capped 0.85. Spreads with `|line|>=9.5` dropped. Prices worse than
  -250 dropped. All-zero L10 Unders dropped.
- Bulk mix per run: 8 × 2-leg Lock, 8 × 3-leg Strong, 6 × 4-leg Stretch, 3 × 5-leg Lottery.
- Player-primary: any ticket with `legs>=3` requires ≥1 player leg; team-market legs capped
  at 40% of the ticket; ≤1 team leg per game; ≥2 distinct games.
- Persists into `cross_sport_sweet_spots` and `bot_daily_parlays` (strategy_name
  `cross_sport_<slot>`); broadcasts top 5 via `bot-send-telegram` type
  `cross_sport_parlay`.
*** End Patch
---
name: team-leg-intelligence
description: Real scoring for team-market and raw-MLB legs in parlay-engine-v2; bans constant 0.66 confidence and drops fat spreads
type: feature
---

Team-market candidates (Spread / Moneyline / Total) and raw MLB player rows
pulled in `parlay-engine-v2 → buildExtraCandidates()` must be scored, not
stamped with constant 0.66 / edge=0. Contract:

1. **Team markets** — confidence = de-juiced implied probability + small
   structural bump (HOME ML +0.04, HOME Spread +0.03, Under Total +0.02,
   everything else +0.01). Capped at 0.85. `edge = confidence - implied`.
2. **Raw MLB player props** — confidence = `PROP_WHITELIST["${propType}|${side}"]`
   hit rate, capped at 0.85. If no whitelist entry exists, drop the candidate
   (`extra:no_model`) rather than synthesizing one.
3. **Fat spreads dropped** — `Math.abs(line) >= MAX_TEAM_SPREAD_ABS` (9.5)
   is rejected at candidate-build time as `extra:spread_too_fat`. Implements
   `mem://logic/betting/spread-filters`.
4. **One team-market leg per game per parlay** — `parlayTeamLegsPerGame` gate
   enforces `MAX_TEAM_LEGS_PER_GAME_IN_PARLAY = 1` so a single parlay can
   never combine, e.g., Cleveland Spread + Cleveland Total. Player props on
   the same game still allowed under the 0.75 concentration cap.
5. **Lottery requires real players** — `mega_lottery_scanner` must include
   at least `MIN_PLAYER_LEGS_IN_LOTTERY = 1` player leg so the upside ticket
   can't collapse into a same-game team-market stack.
6. **Broadcast labels** — `parlay-engine-v2-broadcast` reads `team`,
   `opponent`, `game_description` from persisted leg JSON and renders
   `"<Team> Spread (vs <Opponent>)"` / `"<Team> vs <Opponent>"` instead of
   the legacy "Unknown player" fallback.

All thresholds live in `supabase/functions/_shared/parlay-engine-v2/config.ts`.
---
name: leg-validation-gate
description: Shared hard/soft verification layer that every parlay leg must pass — canonical team, venue alignment, game start, roster, lineup, price-vs-strength, no-same-game
type: feature
---

Shared module: `supabase/functions/_shared/leg-validator.ts`
(+ `canonical-teams.ts` whitelist).

**Hard checks (reject leg):**
1. `team` ∈ canonical whitelist per sport (MLB/NHL/NBA/WNBA/NFL). Truncated
   strings like `"Colorado A…alanche"` fail here — normalized exact match only.
2. Venue alignment: `schedule[event_id].home_team === team` when
   `home_away==="HOME"`, mirror for AWAY. If `home_away` is null, team must
   still equal home OR away in the schedule row.
3. `start_time > now + 5min`.
4. Player on active roster (props only) — only enforced when
   `ctx.rosterTeams` is populated.
5. Spread direction matches Fav/Dog tag (`tag==="Fav"` ⇒ `spread < 0`).

**Cross-leg hard check:** no two legs share `event_id`.

**Soft checks (multiplicative haircut on `safety`/`edge`):**
6. `win_pct < 0.45 && american_odds < -150` → 25% haircut, flag
   `weak_team_heavy_fav`.
7. Lineup unconfirmed within T-120min → 30% haircut; inside T-30 escalates
   to a hard reject (`lineup_unconfirmed_T-30`).

**Fail-open posture:** when a context channel (schedule/roster/lineup) is
empty (loader failed), the corresponding check silently passes. We never
fail-closed on infrastructure outages.

**Wiring:** `cross-sport-parlay-generator` runs every candidate through
`validateLeg(legToValidation(leg), ctx)` after the stale-game filter and
before slot assembly; soft fails reduce `safety_score`. `validateTicket`
also runs inside `violates()` as the final cross-leg gate. Run summary is
returned as `verifier: { rejects, softs, pool_in, pool_out }` in the
response payload.

**Upstream note:** if `unified_props.event_id` is the join key between odds
rows and `live_game_scores`, venue-mismatch hits indicate the join is
correct but one side has stale team labels. If hits cluster on a particular
sport, audit whether that pipeline is joining by team-name substring
instead of `event_id` — the validator catches the symptom; the join fix is
the cure.

Tests: `supabase/functions/_shared/leg-validator_test.ts` (5 cases —
truncated team, venue mismatch, started game, same-game ticket, weak fav
haircut).
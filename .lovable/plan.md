## Why no team parlays today

`cross-sport-sweet-spots` ingests team props (16 MLB ML/spread/total, 2 NBA, 3 NHL future-game rows are active right now) but the **team-leg safety formula is mathematically capped below the 0.60 `lean` threshold**. Even a -250 favorite scores ~0.58, so every team candidate is rejected before reaching the generator. That's why today's 9 parlays are 100% player legs.

Current formula (sweet-spots lines 397–411):
```
conf   = min(0.85, implied + structural_bump)   # bump 0.02–0.04
safety = 0.55*conf + 0.25*clamp(conf - implied + 0.5) + 0.10*(0.5 + 5*research_boost)
```
With zero research boost the max possible safety is ~0.59. Player legs clear because their formula includes `0.45 * l10_hit_rate` (worth up to +0.45). Team legs have no equivalent term.

## Fix plan

### 1. Rebalance team-leg safety scoring
Replace the team-leg block in `cross-sport-sweet-spots/index.ts` so a fair-priced favorite can actually reach `lean`/`strong`:

```
edge        = conf - implied                       # how much the structural bump beat the book
safety_team = 0.55*conf
            + 0.20*clamp01(edge*4 + 0.5)           # was 0.25 of a tiny delta — now meaningful
            + 0.15*clamp01((conf - 0.50)*2)        # "favorite weight" — rewards real favorites
            + 0.10*(0.5 + 5*research_boost)        # unchanged
```
With this, -150 ML home → ~0.66 (lean), -200 → ~0.71 (strong), -110 dog → ~0.55 (still rejected). Caps at 0.85 stay.

### 2. Quota team legs into every multi-leg ticket
Today's generator only *allows* team legs (≤40% cap). Flip it to a soft *floor* for tickets with `legs ≥ 3`:
- `stretch_4` and `lottery_5`: require ≥1 team leg when team pool ≥ 3 candidates that slate.
- If team pool is empty (rare slates), log `team_pool_empty` and fall back to all-player (current behavior).
- `lock_2` and `strong_3`: unchanged (player-primary, team optional).

This makes the "player-primary, team-as-filler" rule from the memory actually visible to the user instead of silently degrading to player-only.

### 3. Per-game team cap unchanged
Keep the existing `≤1 team leg per game` and `|spread| < 9.5` filters — those are working.

### 4. Re-run today
- Mark today's 9 `cross_sport_*` rows in `bot_daily_parlays` as `outcome='void'`, reason `team_leg_starvation`.
- Re-run sweet-spots → generator. Expected: ~6–10 team candidates qualify (MLB favorites + a couple NHL/NBA), 2–3 tickets will carry a team leg.
- Broadcast top 5 with `"Replaces earlier drop — team legs restored"` header via `bot-send-telegram`.

### 5. Tests (5 new, per project rule)
Append to `cross_sport.test.ts`:
1. Team safety: -200 ML home with zero research → safety ≥ 0.70 (`strong`).
2. Team safety: -110 dog → safety < 0.60 (rejected).
3. Team safety: +120 underdog with research_boost 0.05 → safety < 0.60 (rejected, no dog inflation).
4. Generator: stretch_4 with ≥3 team candidates must include ≥1 team leg.
5. Generator: stretch_4 with 0 team candidates falls back to all-player without crashing.

### 6. Memory update
Update `mem/logic/parlay/cross-sport-generator.md`:
- Replace "team legs capped at 40%" with "team legs capped at 40% AND required ≥1 in 4-leg/5-leg tickets when pool ≥ 3".
- Document the new team safety formula.

## Out of scope
- Upstream odds-feed pulling more NHL/NBA games (today's slate is genuinely small — 2 NBA, 3 NHL).
- Spreads ≥9.5 stay banned.
- Research boost weighting unchanged.

## Files to touch
- `supabase/functions/cross-sport-sweet-spots/index.ts` (team safety formula)
- `supabase/functions/cross-sport-parlay-generator/index.ts` (team-leg floor)
- `supabase/functions/cross-sport-parlay-generator/cross_sport.test.ts` (5 new tests)
- `mem/logic/parlay/cross-sport-generator.md` (rules update)
- DB: void today's 9 `cross_sport_*` rows, then re-run pipeline

---
name: Pitcher K Over Model (Ace Edge)
description: Single-actor pitcher strikeouts OVER engine using Bayesian K9 blend, expected IP, opponent K-rate; replaces retired team No-HR model
type: feature
---

## Pitcher Strikeouts Over — "Ace Edge"

Replacement for the retired team No-HR model. Single-actor (pitcher only) so variance is far lower than 9-batter HR exposure, and prices on K Overs (~‑115 to ‑125) leave room for real edge.

### Math

- `K9_blended = Bayesian(L5, season; prior weight = 5 starts)`
- `expected_IP = L10 avg IP per start, capped at 7.0`
- `opp_K_rate_mult = clamp(opponent_team_K% / league_avg_K%, 0.85, 1.20)` — league avg default 0.225
- `park_K_mult = 1.0` default (extensible)
- `expected_K = K9_blended * (expected_IP / 9) * opp_K_rate_mult * park_K_mult`
- `p_over = P(K > line)` via Poisson(λ = expected_K)
- `edge = p_over − implied_prob_at_-115` (≈ 0.535)

### Hard blocks (PASS)

- No K line posted in `unified_props`
- Pitcher < 5 starts this season
- Missing K9 data (no IP samples)
- Missing opponent K-rate (< 200 team ABs in window)
- `expected_IP < 4.5` (opener / short-leash risk)
- Weather rain risk flag (when present)

### Tiers

- **S** — `p_over ≥ 0.68` AND `K9_blended ≥ 10.0` AND opp K% ≥ league avg AND `expected_IP ≥ 5.5` AND `cushion ≥ 1.5`
- **A** — `p_over ≥ 0.65` AND `edge ≥ 0.07` AND `cushion ≥ 1.0` AND `expected_IP ≥ 5.0`
- **PASS** — anything else

### Miss-by-1 guard

`cushion = expected_K - line`. If `cushion < 0.5` → hard block `insufficient_cushion_vs_line`, regardless of pOver. Tightened 2026-06-03 after repeat losses where the line sat at/just above expectation (e.g. Davis Martin Over 5.5 → 2). Naive Poisson p_over ≥ 0.62 is not enough when expectation is only ~0.3 above the line.

### Delivery

- **Standalone Overs only** — never bundled into multi-leg parlays.
- Broadcast cap: **3 picks/day**, S first then A, sorted by `p_over`.
- Schedule: 11:00 AM ET (post lineup pull) + 3:00 PM ET re-run (catch SP scratches).
- Storage: `mlb_pitcher_k_analysis` (full diagnostics) + `category_sweet_spots` with `category=MLB_PITCHER_K_OVER` for digest + settlement reuse.
- Settlement: extends `mlb-over-tracker` — wins iff `pitcher_strikeouts > line` for that pitcher on `game_date`.

### Files

- `supabase/functions/_shared/mlb-pitcher-k-model.ts` — pure math
- `supabase/functions/_shared/mlb-pitcher-k-model_test.ts` — 6 Deno tests (S, A, small sample, early hook, weak K9, edge sanity)
- `supabase/functions/mlb-pitcher-k-analyzer/index.ts` — orchestrator

### Constraints

- Telegram broadcast MUST invoke `bot-send-telegram` with `admin_only: true`. Passing `false` causes the bot to silently return `{ skipped: true }`.
- After a confirmed send, stamp `mlb_pitcher_k_analysis.broadcast_sent_at = now()` for the broadcast pitchers on `game_date`.
- Opponent K-rate uses team batter-rows aggregated over the loaded 180-day window, requires ≥ 200 ABs to be considered reliable.

### Replaced

`mem://logic/betting/no-hr-team-model` — retired 2026-05-02 after 0/3 broadcast.
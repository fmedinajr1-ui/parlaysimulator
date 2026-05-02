---
name: No HR Team Model
description: Team-level "1st HR Type — No" engine using Poisson p_no_hr from team HR/g, opposing pitcher HR/9, park & weather; standalone S+A only, max 3/day
type: feature
---

> **STATUS: RETIRED 2026-05-02.** Went 0/3 on broadcast 2026-05-01 (Rangers, Marlins, Blue Jays — all teams homered). Structural problem: 9-batter HR risk dominates park+pitcher signal at the prices "No HR" pays (~-140 to -180). The `mlb-no-hr-team-analyzer` edge function early-returns `{disabled:true}`; data table preserved for audit. Replacement: see `mem://logic/betting/pitcher-k-over-model`.

## No Home Run (Team) Engine

Models the DraftKings "1st Home Run Type — No" market: bet wins if the chosen team hits 0 HR in the game.

### Math
- `blended_HR/g = Bayesian(L30, season; prior=30 games)`
- `pitcher_mult = clamp(opp_pitcher_HR9 / 1.20, 0.55, 1.8)`; unknown → 1.0
- `env_mult = park_HR_factor * weather_mult`
- `λ = blended_HR/g * pitcher_mult * env_mult`
- `p_no_hr = exp(-λ)` (Poisson)

### Hard blocks (PASS)
- Missing pitcher data (no announced starter, < 10 IP sample)
- Team L30 ≥ 1.5 HR/g (power team)
- Park HR factor ≥ 1.20 AND env_mult ≥ 1.10 (Coors / Cincy with wind)
- Pitcher HR/9 > 1.6 AND team L7 > 1.0 HR/g (hot bats vs gopher pitcher)

### Tiers
- **S** — `p_no_hr ≥ 0.62` AND ace pitcher (HR/9 ≤ 0.9) AND friendly park (≤1.0) AND low-power team (blended ≤ 0.9)
- **A** — `p_no_hr ≥ 0.55`
- **B** — `p_no_hr ≥ 0.50` (war-room only, NOT broadcast)

### Delivery rules
- **Standalone bets only** — never bundled into multi-leg parlays (price too short, correlation risk).
- **Broadcast cap: 3 picks/day**, S first then A, sorted by p_no_hr.
- **Schedule:** 10:30 AM ET (post lineup pull) + 2:30 PM ET re-run (catch scratches/SP swaps).
- Storage: `mlb_no_hr_team_analysis` (full diagnostics) + `category_sweet_spots` with `category=MLB_NO_HR_TEAM` for digest + settlement reuse.
- Settlement: extends `mlb-over-tracker` — wins iff `SUM(team home_runs on date) = 0`.

### Files
- `supabase/functions/_shared/mlb-no-hr-team-model.ts` — pure math
- `supabase/functions/_shared/mlb-no-hr-team-model_test.ts` — 6 Deno tests
- `supabase/functions/_shared/mlb-park-factors.ts` — 30-park HR factor table
- `supabase/functions/mlb-no-hr-team-analyzer/index.ts` — orchestrator

### Constraints
- Telegram broadcast MUST invoke `bot-send-telegram` with `admin_only: true`. Passing `false` causes the bot to silently return `{ skipped: true }` and the message is never sent.
- After a confirmed send, stamp `mlb_no_hr_team_analysis.broadcast_sent_at = now()` for the broadcast teams on `game_date`. Use this column to verify delivery instead of trusting the invoke return alone.
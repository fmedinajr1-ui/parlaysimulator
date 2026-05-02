## Why kill "No HR Team"

You broadcast 3 picks on 2026‑05‑01 (Rangers, Marlins, Blue Jays — all p≈0.58–0.60 / A‑tier). Every team homered. That's not random bad luck — it's a structural problem with the market:

- **One batter ruins the whole bet.** A 9‑man lineup with even 0.10 HR/PA each gives ~60% chance someone hits one. Our model needs `p_no_hr ≥ 0.55` to fire, which math‑wise means λ ≤ 0.6 HR/game. Modern MLB averages ~1.1 HR/team/game. The window where we have a real edge is razor‑thin and dominated by variance.
- **Park + pitcher + weather aren't enough signal** to overcome lineup‑wide HR risk. We have no batter‑level data in the model.
- **Price is short.** "No HR" usually pays around ‑140 to ‑180. One miss erases 2–3 wins.

Recommendation: shut off the broadcast, keep the analyzer table around for a week so you can backfill outcomes and confirm, then delete.

## What to replace it with: Pitcher Strikeouts Over — "Ace Edge"

This uses the **same infrastructure** (analyzer → `category_sweet_spots` → digest → settlement) but flips to a market with much better signal/noise:

- **Single‑actor market** — only the pitcher matters, no 9‑lineup variance.
- **You already have the data** — `mlb_player_game_logs.pitcher_strikeouts` and `innings_pitched`, 62k rows back to Apr 2025.
- **Park/weather barely matter** — model is cleaner, fewer block gates needed.
- **Asymmetric upside** — strikeout overs typically priced ‑115 to ‑125, not ‑170.

### Model

```text
expected_K = pitcher_K9_blended * expected_IP * opponent_K_rate_mult * park_K_mult
p_over = P(K > line)  via Poisson(λ = expected_K)
```

Inputs:
- `pitcher_K9_blended` — Bayesian shrink of L5 starts vs season (prior weight 5 starts)
- `expected_IP` — pitcher's L10 average IP per start (cap 7.0)
- `opponent_K_rate_mult` — opponent team K% / league avg K% (clamped 0.85–1.20)
- `park_K_mult` — neutral 1.0 default; can extend later from existing park‑factor file
- `line` — pulled from `unified_props` where `prop_type='pitcher_strikeouts'`

### Tiers / hard blocks

- **PASS** if: pitcher < 5 starts this season, opponent K% missing, line not posted, weather (rain risk) flag, OR `expected_IP < 4.5` (early hook risk).
- **A** if `p_over ≥ 0.62` and edge over implied prob ≥ 5%.
- **S** if `p_over ≥ 0.68`, K9 ≥ 10.0, opp K_rate ≥ league avg, and `expected_IP ≥ 5.5`.

### Delivery

- Standalone bets only, **max 3/day**, S first.
- Schedule: 11:00 AM ET (post‑lineup) + 3:00 PM ET re‑run (catch SP scratches).
- Reuse Telegram broadcast wrapper (`bot-send-telegram`, `admin_only: true`) — same pattern that the No‑HR analyzer uses, so you keep the muscle memory.
- Stamp `broadcast_sent_at` after confirmed send.

### Settlement

Extends `mlb-over-tracker`: WIN iff `pitcher_strikeouts > line` for that pitcher on `game_date`.

## Files

**New:**
- `supabase/functions/_shared/mlb-pitcher-k-model.ts` — pure math (`modelPitcherKOver`)
- `supabase/functions/_shared/mlb-pitcher-k-model_test.ts` — 6 Deno tests (S tier, A tier, pass on small sample, pass on weak K9, pass on early hook, edge calc)
- `supabase/functions/mlb-pitcher-k-analyzer/index.ts` — orchestrator
- `mem/logic/betting/pitcher-k-over-model.md`

**Edit:**
- `mem/index.md` — add reference to new memory file
- `supabase/functions/mlb-no-hr-team-analyzer/index.ts` — early return with `{ disabled: true, reason: 'retired_after_0-3_2026-05-01' }`. No DB drop yet — keep table for audit.
- `mem/logic/betting/no-hr-team-model.md` — add a **Status: RETIRED** banner at the top with the 0‑3 evidence.

**Schema:** new table `mlb_pitcher_k_analysis` mirroring no‑HR shape (pitcher, opponent, line, expected_K, p_over, tier, broadcast_sent_at, outcome, actual_k).

## What I am NOT changing

- Cascade alerts, sim panel, parlay engine — untouched.
- Existing RBI Unders / over tracker — untouched.
- The No‑HR table data — preserved for backfill audit.

## Open question (won't block)

Want the broadcast to go to the **same Telegram channel** as the old No‑HR picks, or a separate "Pitcher K" channel? Default = same channel.

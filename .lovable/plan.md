

The user is asking about the sweet spot generator in context of the previous overhaul (removing DNA/integrity filters, fixing parlay generators). They want to know if it should also be reviewed/fixed.

Let me check what sweet spot generators exist and their current state before presenting a plan.

Key sweet spot functions I know of from context:
- `category_sweet_spots` table — daily picks
- `broadcast-sweet-spots` — sends digest to Telegram
- `settle-hedge-snapshots` — settles hedge tracker snapshots
- Sweet spot ranking engine (mem://logic/stats/sweet-spot-quality)

I should check accuracy data and propose a plan similar to the parlay overhaul.

# Sweet Spot Generator Review

## What I'll audit
Pull the last 14 days of `category_sweet_spots` and `sweet_spot_hedge_snapshots` to determine:
- Total picks generated per day
- Settlement rate (% with `actual_value` filled)
- Hit rate by quality tier (ELITE / PREMIUM / STRONG / STANDARD)
- Hit rate by prop type (points, assists, threes, rebounds, etc.)
- Hit rate by recommended_side (OVER vs UNDER)
- Confidence-score correlation with outcome
- Whether `broadcast-sweet-spots` is actually firing daily

## Likely fixes (pending audit numbers)
Based on the same root causes that broke the parlay generators:

1. **Remove DNA / integrity hooks** if `category_sweet_spots` inserts are routed through `bot-parlay-integrity-check` or `analyze-pick-dna` post-processing
2. **Fix settlement matching** — same player-name/date mismatch issue that voided 17/20 cascade tickets likely affects sweet spot hedge snapshots (`settle-hedge-snapshots` uses lowercase trim match — may miss accent/suffix variants)
3. **Lower confidence floor on broadcast** if today's slate is empty due to the `>= 70` gate (matches the RBI 60% gate problem)
4. **Drop the fake-line filter** in `ScoutSweetSpotProps.tsx` that excludes lines `< 1.5` if it's hiding valid 3PT/STL/BLK picks
5. **Add chunking to `broadcast-sweet-spots`** — same Telegram 4096-char limit issue that broke the cascade slate

## Plan
1. **Audit only** (read-only): query DB + edge logs, post results in chat with per-tier hit rates + settlement %
2. Based on audit numbers, present a follow-up plan with specific generator fixes

This is a 2-step plan — first the diagnostic, then targeted fixes. No code changes in step 1.

## Output
A summary table in chat showing sweet spot accuracy + settlement health + a list of 2-4 concrete fixes with file paths.


---
name: mlb-rbi-system
description: MLB RBI Unders pipeline — 4-variant Poisson bake-off, settlement tracking, and broadcast promotion strategy
type: feature
---

# MLB RBI Unders system

## Why
The original RBI analyzer was deleted; `mlb_rbi_under_analysis` last wrote 2026-04-11. We rebuilt it from scratch with a 4-variant bake-off so the winning gate is decided by settled data, not memory.

## Core math
`expected_RBI = RBI_per_PA_blended * expected_PA * pitcher_quality_mult * park_RBI_mult * lineup_spot_mult`
- `RBI_per_PA_blended`: Bayesian shrink of L15 toward season prior (PRIOR_PA=60).
- `expected_PA`: 1–2: 4.4, 3–5: 4.2, 6–9: 3.8.
- `pitcher_quality_mult = clamp(era / 4.20, 0.65, 1.25)`.
- `lineup_spot_mult`: 1.00 / 1.05 / 0.92 by spot bucket.
- `pUnder = poissonCDF(floor(line), expected_RBI)`.
- `edge = pUnder - 0.535` (implied @ -115).

## Universal hard blocks (apply to ALL variants)
- Line not posted.
- Sample < 30 PA.
- Park = Coors Field.
- L10 RBI/PA > 0.18 AND lineup spot 3–5 (hot middle-order bat).

## Variants (run every scan, one row per (player × variant passed))
| Variant | L3 gate | Other |
|---|---|---|
| A | L3 RBI/PA ≤ 0.06 | pUnder ≥ 0.66, edge ≥ 0.05 |
| B | L3 total RBIs ≤ 0.6 | pUnder ≥ 0.66, edge ≥ 0.05 |
| C | none (Bayesian only) | pUnder ≥ 0.68, edge ≥ 0.05 |
| D | L3 RBIs ≤ 1 AND pUnder ≥ 0.68 | edge ≥ 0.05 |

S tier within any variant: pUnder ≥ 0.74 AND edge ≥ 0.08.

## Promotion (during bake-off)
- Only **variant C** rows feed `category_sweet_spots` and Telegram. A/B/D shadow-track for accuracy comparison.
- After ~7 days of settled data, switch promotion to whichever variant wins on `mlb_rbi_under_variant_accuracy` view.

## Settlement
- `mlb-over-tracker` grades both `category_sweet_spots` (MLB_BATTER_RBI_UNDER) and `mlb_rbi_under_analysis` variant rows.
- Under wins when `actual_rbis ≤ floor(line)`. DNP → VOID.

## Cron
- 11:05 AM ET and 3:05 PM ET (`mlb-rbi-under-analyzer-morning` / `-afternoon`).

## Accuracy view
Query `SELECT * FROM mlb_rbi_under_variant_accuracy;` for per-variant settled win-rate and 7-day window.

## Files
- `supabase/functions/_shared/mlb-rbi-under-model.ts` (+ `_test.ts`)
- `supabase/functions/mlb-rbi-under-analyzer/index.ts`
- `supabase/functions/mlb-over-tracker/index.ts` (PART 2d)
- DB: `mlb_rbi_under_analysis` (variant, line, p_under, edge, expected_rbi, l3_rbis, l3_rbis_per_pa, lineup_spot, park, reason, result, actual_rbis, settled_at)
- DB view: `mlb_rbi_under_variant_accuracy`
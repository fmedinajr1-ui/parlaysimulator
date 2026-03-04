

## Pipeline Protocol Verification — March 4, 2026 (Post-Fix)

### Fixes Applied This Session

| Fix | File | What Changed |
|-----|------|-------------|
| Cluster builder L10 gate | `bot-generate-daily-parlays` line 9075 | Changed from `pick.confidence_score` (wrong field — composite score 0-1) to `pick.l10_hit_rate` (actual L10 hit rate). Shootout/grind clusters now correctly enforce 80% L10 minimum. |
| Quality regen dedup | `bot-quality-regen-loop` lines 212-257 | Removed the guard `bestAttempt.parlayIds.length > 0` that prevented dedup when source tag attribution failed. Dedup now runs unconditionally on ALL pending parlays for today, ordered by `created_at` (keeps oldest, voids dupes). |
| Force-fresh L10 gate | `bot-force-fresh-parlays` | Already correctly deployed — uses `sweetSpotLookup` from `category_sweet_spots`. The 9 existing `force_mispriced_conviction` parlays were generated before the latest deployment. Gate is working (blocks picks with <80% L10 or no sweet spot data). |

### Expected Outcome After Clean & Rebuild
- Shootout cluster: 0-1 parlays (only if 3+ picks have 80%+ L10 hit rate AND pass coherence)
- Role-stacked: 1 copy each of 5-leg and 8-leg (no more 3x duplicates)
- Force-mispriced: Only picks with 80%+ L10 from sweet spot data
- Curated pipeline: Unchanged (already working)

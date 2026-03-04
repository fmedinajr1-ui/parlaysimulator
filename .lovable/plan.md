## Plan: Pipeline Fine-Tuning — Hit Rate Optimization ✅

### Changes Applied

1. **Shootout stack capped** — Cluster parlays for `shootout_stack` (16% WR) capped at 1 per day (was 3). Grind stack unchanged at 3.

2. **Double-confirmed conviction BOOSTED** — Added 7 new execution-tier profiles for `double_confirmed_conviction` (54.5% WR): 80%+ L10 hit rate profiles, hit_rate/shuffle sort variations, bringing total conviction profiles from 6 to 13.

3. **Multi-leg role-stacked builder** — New section in `bot-generate-daily-parlays` auto-builds 5-leg and 8-leg tickets from execution-quality picks using SAFE/BALANCED/GREAT_ODDS role assignments. Requires 65%+ L10 hit rate with real lines.

4. **bot-curated-pipeline created** — New edge function that automates the manual curation workflow: loads defense rankings → cross-references sweet spots + mispriced + high conviction engines → filters to 2+ engine consensus with 65%+ L10 → builds 3/5/8/13-leg tickets → broadcasts via Telegram.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Shootout cap, conviction boost, multi-leg builder |
| `supabase/functions/bot-curated-pipeline/index.ts` | Created — automated curation pipeline |

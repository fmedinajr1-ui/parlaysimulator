

# Tighten RBI Thresholds & Redeploy

## Change
Update `mlb-cascade-parlay-generator/index.ts` thresholds from the current 0.3–0.7 range to the tighter **0.5–0.6** range you requested:

```
MIN_AVG_RBI = 0.3 → 0.5
MAX_AVG_RBI = 0.7 → 0.6
```

This ensures every leg in the parlay has a player averaging between 0.5 and 0.6 RBI over L10 — the true sweet spot for Under 0.5 RBI bets.

## Files
- **Edit**: `supabase/functions/mlb-cascade-parlay-generator/index.ts` — update two constants
- **Deploy**: both `mlb-cascade-parlay-generator` and `mlb-cascade-parlay-settler`


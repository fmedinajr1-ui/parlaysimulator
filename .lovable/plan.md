

# Fix Lottery Scanner — Real Lines + DNA Audit

## Problems
1. Lottery scanner legs don't include `has_real_line`, `line_source`, or `line_verified_at` — DNA audit can't distinguish verified vs projected lines
2. Legs lack proper enrichment fields (`l10_std_dev`, `l10_min`, `l10_max`, `l3_avg`, `l5_avg`, `season_avg`, `h2h_avg_vs_opponent`, `projected_value`) that the DNA scorer needs to compute meaningful scores
3. The orchestrator doesn't run DNA audit on lottery parlays after they're generated

## Plan

### Step 1: Enrich lottery legs with real line verification + DNA-compatible fields
**File: `supabase/functions/nba-mega-parlay-scanner/index.ts`**

In the leg serialization block (~line 1176), add the fields DNA expects:
- `has_real_line: true` (these come direct from FanDuel/HardRock API)
- `line_source: 'fanduel'` or the bookmaker name
- `l10_std_dev`, `l10_min`, `l10_max` — pull from `category_sweet_spots` query (already fetching `l10_avg`, need to add these columns)
- `l3_avg`, `l5_avg`, `season_avg` — pull from sweet spots or game logs
- `h2h_avg_vs_opponent`, `projected_value` — from mispriced lines data

Update the `category_sweet_spots` select query (~line 506) to also fetch: `l10_std_dev`, `l10_min`, `l10_max`, `l3_avg`, `l5_avg`, `season_avg`, `h2h_avg_vs_opponent`

Update `ScoredProp` interface to carry these new fields through scoring.

Update the `parlayLegsJson` mapping (~line 1176) to include all DNA-required fields:
```typescript
has_real_line: true,
line_source: leg.bookmaker || 'fanduel',
l10_std_dev: leg.l10StdDev || 0,
l10_min: leg.l10Min || 0,
l10_max: leg.l10Max || 0,
l3_avg: leg.l3Avg || leg.l10Avg,
l5_avg: leg.l5Avg || leg.l10Avg,
season_avg: leg.seasonAvg || leg.l10Avg,
h2h_avg_vs_opponent: leg.h2hAvg || 0,
projected_value: leg.l10Avg || 0,
```

### Step 2: Run DNA audit on lottery parlays
**File: `supabase/functions/refresh-l10-and-rebuild/index.ts`**

The DNA audit (Phase 3g) already runs on ALL pending parlays including lottery ones. However, the lottery scanner runs in the orchestrator *before* the DNA audit — need to verify ordering. If lottery runs after DNA audit, move it before or add a second DNA pass after lottery generation.

### Step 3: Cross-verify lines against `unified_props`
**File: `supabase/functions/nba-mega-parlay-scanner/index.ts`**

After scoring props, cross-reference each selected leg against `unified_props` to confirm the line matches a verified FanDuel line. If the Odds API line differs from unified_props by more than 1 point, flag it as stale.

## Files Changed
1. `supabase/functions/nba-mega-parlay-scanner/index.ts` — Add real line flags, enrich legs with DNA fields, cross-verify against unified_props
2. `supabase/functions/refresh-l10-and-rebuild/index.ts` — Ensure DNA audit runs after lottery generation (verify ordering)


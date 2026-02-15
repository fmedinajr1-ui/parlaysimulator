

# Auto-Block/Boost Totals by Sport

## What We're Doing

Flipping the totals strategy per sport based on performance data:
- **NCAAB**: Block OVER_TOTAL (29.4% hit rate), boost UNDER_TOTAL
- **NBA**: Block UNDER_TOTAL (38.5% hit rate), boost OVER_TOTAL (100% on small sample)

## The Problem

The current weight system is NOT sport-aware. There's one `OVER_TOTAL__over` entry that applies to ALL sports. So we can't simply block OVER_TOTAL globally — that would kill NBA overs too (which are winning).

## Solution

### Step 1: Create Sport-Specific Weight Entries

Replace the single global entries with sport-specific ones in `bot_category_weights`:

| Category | Side | Sport | Weight | Blocked? |
|----------|------|-------|--------|----------|
| OVER_TOTAL | over | basketball_ncaab | 0 | Yes (29.4% hit rate) |
| OVER_TOTAL | over | basketball_nba | 1.20 | No (boosted) |
| UNDER_TOTAL | under | basketball_ncaab | 1.20 | No (boosted) |
| UNDER_TOTAL | under | basketball_nba | 0 | Yes (38.5% hit rate) |

### Step 2: Make Weight Lookup Sport-Aware

Update the generation pipeline (`bot-generate-daily-parlays`) to build sport-specific weight keys:
- Primary lookup: `category__side__sport` (e.g., `OVER_TOTAL__over__basketball_ncaab`)
- Fallback: `category__side` (existing behavior)
- Final fallback: `category` only

This requires a small change to the weight map builder (lines 3163-3171) and the lookup calls throughout the file (~5 spots).

### Step 3: Update Category Props Analyzer

The `autoFlipUnderperformingCategories` function in `category-props-analyzer` also needs to respect sport-level granularity so future auto-flips don't overwrite sport-specific entries.

## Technical Details

### Files Modified
- `supabase/functions/bot-generate-daily-parlays/index.ts` — Sport-aware weight map keys
- `supabase/functions/category-props-analyzer/index.ts` — Sport-aware auto-flip
- Database: Insert 4 new sport-specific weight rows, block the old global ones

### Weight Map Change (Generation Pipeline)
```typescript
// Before: category__side only
weightMap.set(`${w.category}__${w.side}`, w.weight);

// After: add sport-specific key
if (w.sport) {
  weightMap.set(`${w.category}__${w.side}__${w.sport}`, w.weight);
}
weightMap.set(`${w.category}__${w.side}`, w.weight);
```

### Lookup Change
```typescript
// Before
const weight = weightMap.get(`${cat}__${side}`) ?? 1.0;

// After: try sport-specific first
const weight = weightMap.get(`${cat}__${side}__${sport}`) 
  ?? weightMap.get(`${cat}__${side}`) 
  ?? 1.0;
```

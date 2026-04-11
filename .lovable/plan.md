

# Fix Pipeline Errors: category-props-analyzer + nba-mega-parlay-scanner

## Errors Found

### 1. category-props-analyzer — TWO bugs

**Bug A: `.catch is not a function` (FATAL)**
Line 1202: `await supabase.from('bot_activity_log').insert({...}).catch(() => {})` — the Supabase JS client returns a `PostgrestBuilder` (thenable but NOT a real Promise), so `.catch()` doesn't exist. This crashes the entire function.

**Fix:** Wrap in try/catch or convert to real promise first.

**Bug B: Wrong column name `archetype`**
Line 392: `.select('player_name, archetype')` but the actual column is `primary_archetype`. This causes a warning and empty archetype cache (non-fatal but degrades quality).

**Fix:** Change `archetype` → `primary_archetype` in the select and the row accessor at line 395.

### 2. nba-mega-parlay-scanner — `Assignment to constant variable`

The deployed version has a `const` being reassigned (likely `defenseRank` or `defenseBonus` was `const` in a prior deploy). The current repo code already uses `let` for both. A **redeploy** of the function should fix this.

### 3. Final Verdict — 0 picks / Lottery — 0 tickets

These are downstream consequences. When category-props-analyzer crashes, it produces zero sweet spots, so the parlay generators and verdict engine have nothing to work with. Fixing bugs 1A and 1B should restore output.

## Changes

| File | Change |
|------|--------|
| `supabase/functions/category-props-analyzer/index.ts` | Line 392: `archetype` → `primary_archetype`; Line 395: `row.archetype` → `row.primary_archetype`; Line 1198-1202: wrap `.insert()` in try/catch instead of `.catch()` |
| `supabase/functions/nba-mega-parlay-scanner/index.ts` | Redeploy (code already correct in repo) |

Both functions will be redeployed after edits.


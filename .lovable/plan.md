

# Guard Against Negative Edge Picks in Mispriced Strategies

## What Went Wrong

The bot selected legs with **negative edge_pct** (as low as -67%) because the system treats edge percentage by absolute value in multiple places. A pick with -67% edge gets the same priority as +67% edge -- this is fundamentally broken. There are three places where negative-edge picks leak through:

1. **Enrichment phase (line 5368)**: Uses `Math.abs(ml.edge_pct)` to score picks, so negative edges get high composite scores
2. **Sweep pass (line 8659)**: Sorts by `Math.abs(edge_pct)`, treating -67% the same as +67%
3. **No edge_pct filter at pool entry**: The mispriced lines are fetched with `gte('edge_pct', -999)` (line 3939) -- literally accepting everything

The existing negative-edge gate (line 6391) only checks projection buffer, not the raw `edge_pct` value from mispriced_lines.

## Fix Plan

### 1. Filter negative edge_pct at the source query (line 3939)

Change the mispriced lines fetch from `gte('edge_pct', -999)` to only pull lines where the edge is positive (or at least directionally correct). Since the signal already encodes direction (OVER/UNDER), the `edge_pct` should always be positive for a correctly identified mispricing.

- Change: `.gte('edge_pct', 3)` -- require minimum 3% edge (matches `BOT_RULES.MIN_EDGE`)

### 2. Add explicit edge_pct guard in enrichment (line 5365)

After mapping mispriced lines to enriched picks, add a filter that blocks any pick where `edge_pct` is negative or below the 3% minimum threshold.

### 3. Add edge_pct guard in the sweep pass (line 8653)

Filter `unusedMispriced` to only include lines with positive `edge_pct >= 3` before building sweep parlays. Remove the `Math.abs()` wrapping since all edges should now be positive.

### 4. Add edge_pct guard in leg selection (near line 6380)

When building parlay legs, check if the pick has an `edge_pct` property and block it if negative. This is the final safety net.

## Files Modified

- **`supabase/functions/bot-generate-daily-parlays/index.ts`**
  - Line 3939: Change fetch filter from `gte('edge_pct', -999)` to `gte('edge_pct', 3)`
  - Line 5365: Add `.filter()` after `.map()` to reject picks with negative/low edge
  - Line 5368: Remove `Math.abs()` -- use raw `edge_pct` since negatives are now filtered
  - Line 8653: Add edge_pct >= 3 filter to sweep candidates
  - Line 8659: Remove `Math.abs()` from sweep sort
  - Line ~6391: Add explicit `edge_pct` check as final safety net in leg assembly

These changes ensure no negative-edge pick enters the pipeline at any stage -- from data fetch through enrichment to final parlay assembly.


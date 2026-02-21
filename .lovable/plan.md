

## Use Remaining Legs: Force-Build Parlays from Leftover Mispriced Lines

### Current Situation

Today there are 101 mispriced lines but only 18 parlays were built. Many high-edge legs (like Jalen Suggs blocks +172%, Desmond Bane threes +99%) are sitting unused. The cross-reference system is active but only 1 risk engine pick exists today, so almost no overlaps are found.

### What This Plan Does

Add a "sweep" pass to the parlay generator that takes unused mispriced lines and forces them into additional parlays, prioritizing the highest-edge plays.

### Changes

**1. Add a Sweep Strategy to `bot-generate-daily-parlays`**

After the normal generation tiers (execution, validation, exploration) complete, run a final "sweep" pass:

- Collect all mispriced line player/prop combos that were NOT used in any generated parlay
- Sort by absolute edge percentage (highest first)
- Group into 3-leg parlays using relaxed rules:
  - Max 1 player per parlay (no same-player stacking)
  - Prefer mixing OVER and UNDER for hedge protection
  - Skip the PropTypeCap entirely for sweep parlays (these are leftovers)
  - Skip fingerprint dedup against existing parlays (sweep is meant to cover gaps)
- Tag these as `tier: 'sweep'` and `strategy_name: 'leftover_sweep'`
- Cap at 10 sweep parlays per run to avoid noise

**2. Update the HighConvictionCard UI**

Add `mlb_cross_ref` to the engine colors/labels map so when MLB picks do start flowing, they render properly:
- Color: purple (`bg-purple-500`)
- Label: "MLB XRef"

**3. Improve Cross-Reference Coverage**

The core issue is that only 1 engine (risk) produced picks today. To get more cross-referencing working now (not just when MLB starts):
- In the high-conviction-analyzer, also query `bot_daily_parlays` legs as an engine source. If a mispriced line's player+prop appears in an existing parlay leg, that counts as a "bot" engine match
- This creates a feedback loop: the parlay generator already validated these picks, so their presence confirms the mispriced signal

### Technical Details

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

Add sweep pass after line ~6420 (after all tier generation):

```text
// Sweep pass: collect unused mispriced lines
1. Get all player+prop combos from generated parlays (this run + existing)
2. Filter mispriced lines to those NOT in the used set
3. Sort remaining by |edge_pct| descending
4. Greedily build 3-leg combos:
   - No two legs from same player
   - Alternate OVER/UNDER when possible
5. Insert as tier='sweep', strategy_name='leftover_sweep'
6. Cap at 10 parlays
```

**File: `supabase/functions/high-conviction-analyzer/index.ts`**

Add bot_daily_parlays as a 7th engine source:
- Query today's `bot_daily_parlays`, extract each leg's player_name + prop_type
- Add to engineMap with `engine: 'bot_parlay'`

**File: `src/components/market/HighConvictionCard.tsx`**

Add to ENGINE_COLORS and ENGINE_LABELS:
```text
mlb_cross_ref: { color: 'bg-purple-500', label: 'MLB XRef' }
bot_parlay:    { color: 'bg-cyan-500',   label: 'Bot' }
```

### Expected Impact

- Leftover high-edge mispriced lines get used in sweep parlays instead of sitting idle
- Cross-reference coverage improves immediately by treating existing parlay legs as confirmation signals
- MLB cross-ref labels ready for when season data flows in
- Each run should produce 18 (current) + up to 10 sweep = ~28 parlays


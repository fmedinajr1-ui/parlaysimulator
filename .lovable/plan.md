

# Re-enable Lottery Standard Tier with Targeted Fixes

## What Went Wrong
The entire `nba-mega-parlay-scanner` was disabled (hard early-return at line 172) because of poor overall lottery performance. But the **standard tier alone is +$5,251 lifetime** (2 wins at +1052 and +1096 odds vs $63 in losses). The high_roller and mega_jackpot tiers were the actual money burners.

## Root Issues in Recent Standard Losses (March 5-13)
1. **POISON_FLIP_MAP forcing bad sides** — Blanket forces UNDER on rebounds, assists, threes, steals. Recent losses show legs like "Adem Bona rebounds UNDER 6.5" missing at 7 — the flip map overrides what the data says.
2. **57% void rate** — Players getting scratched post-generation. The pre-tip lineup check (now scheduled at 5:30 PM ET) should reduce this.
3. **"Filler" legs with weak signal** — Legs tagged `leg_role: filler` with only +100 odds and no edge are dragging tickets down.

## Plan

### 1. Re-enable the scanner for standard tier only
**File**: `supabase/functions/nba-mega-parlay-scanner/index.ts`
- Remove the hard early-return at lines 172-176
- Add a tier filter so only `standard` tickets are generated (skip `high_roller` and `mega_jackpot` builds)
- This preserves the profitable standard tier while keeping the two losing tiers disabled

### 2. Soften the POISON_FLIP_MAP
**File**: `supabase/functions/nba-mega-parlay-scanner/index.ts` (lines 32-39)
- Instead of blanket-forcing UNDER, make it conditional: only apply the flip when the player's L10 average supports it (e.g., flip to UNDER only if L10 avg is below the line)
- If L10 avg is above the line, respect the original OVER side
- This prevents the map from overriding strong statistical signals

### 3. Tighten filler leg quality
- Require filler legs to have `hit_rate >= 70%` (currently accepts anything)
- Require filler legs to have L10 data available (no blind picks)
- Cap filler legs at 1 per ticket to reduce exposure to low-signal picks

### 4. Keep it aligned with the new 5:30 PM ET generation window
The standard lottery ticket will now generate at 5:30 PM ET along with the rest of the pipeline, benefiting from confirmed lineups and reducing the void rate.

## Files to Change
| File | Change |
|------|--------|
| `supabase/functions/nba-mega-parlay-scanner/index.ts` | Remove early-return, filter to standard-only, soften poison flip, tighten filler quality |

## Expected Impact
- Standard tier resumes with its proven +8,300% ROI profile
- Fewer voids from the pre-tip generation window
- Better leg selection from data-driven side picks instead of blanket flips
- High_roller and mega_jackpot remain disabled (the actual losers)


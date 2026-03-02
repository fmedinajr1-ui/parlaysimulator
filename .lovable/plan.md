

# Void Standard Lottery Ticket (Jaylen Brown Out) and Regenerate

## Current Situation
- Standard lottery ticket `f649e91b` has Jaylen Brown Under 1.5 Threes as leg 1
- Jaylen Brown is OUT today -- this ticket is dead
- The other 2 tickets (High Roller, Mega Jackpot) are fine and should NOT be touched

## Problem
The scanner's `force` mode voids ALL tiers. There's no way to void just one tier and regenerate only that tier.

## Changes

### File: `supabase/functions/nba-mega-parlay-scanner/index.ts`

**Add `void_tier` parameter** (around lines 178-184):

```text
let voidTier: string | null = null;
// in body parsing:
voidTier = body?.void_tier ?? null;  // e.g. "standard", "high_roller", "mega_jackpot"
```

**Update force mode block** (lines 191-201) to filter by tier when `void_tier` is provided:

```text
if (forceMode) {
  let query = supabase
    .from('bot_daily_parlays')
    .update({ outcome: 'void', lesson_learned: 'force_regen_lottery' })
    .eq('parlay_date', today)
    .eq('strategy_name', 'mega_lottery_scanner')
    .neq('outcome', 'void');
  
  if (voidTier) {
    query = query.eq('tier', voidTier);
  }
  
  const { data: voidedRows, error: voidErr } = await query.select('id');
  // ... existing logging
}
```

This way, calling with `{ force: true, void_tier: "standard", exclude_players: ["Jaylen Brown"] }` will:
1. Void ONLY the standard tier ticket
2. Leave high roller and mega jackpot untouched
3. Regenerate a new standard ticket excluding Jaylen Brown

### Immediate Action After Deploy

Call the scanner with:
```json
{
  "force": true,
  "void_tier": "standard",
  "exclude_players": ["Jaylen Brown"]
}
```

## Deployment
Deploy updated `nba-mega-parlay-scanner` edge function, then invoke it with the targeted parameters.

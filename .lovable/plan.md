

## Fix and Redeploy bot-force-fresh-parlays

### Problems Found

1. **Stale deployment**: The edge function running in production is the old version without performance-aware scoring or prop blocking. The code in the repo is correct but needs redeployment.

2. **Static blocking of `player_blocks` is wrong**: The data shows `player_blocks` has a **71% hit rate** over 7 legs -- it's actually one of the better-performing prop types. The static blocklist should be removed entirely and replaced purely with dynamic data-driven blocking.

3. **Missing log for performance load**: The "[ForceFresh] Loaded..." log confirms data loading works, but deployment is needed.

### Changes

**1. Remove static `player_blocks` from blocklist in `bot-force-fresh-parlays/index.ts`**

The `STATIC_BLOCKED_PROP_TYPES` set currently blocks both `player_steals` and `player_blocks`. Since `player_blocks` has a 71% win rate, it should NOT be statically blocked. Change to only keep the dynamic system:

```typescript
// Before:
const STATIC_BLOCKED_PROP_TYPES = new Set(['player_steals', 'player_blocks']);

// After: Only keep steals as static fallback, let data drive blocks
const STATIC_BLOCKED_PROP_TYPES = new Set(['player_steals']);
```

**2. Same fix in `bot-generate-daily-parlays/index.ts`**

Remove `player_blocks` from any static blocklist there as well, since the performance data shows it wins at 71%.

**3. Redeploy the edge function**

After the code fix, the function will be automatically redeployed with the full performance-aware logic (dynamic blocking, player bonuses, conviction scoring).

**4. Void the 8 test parlays just generated**

These were generated with stale logic and contain blocked prop types. They should be voided so they don't count against the bot's record.

### What This Fixes

- The redeployed function will correctly load `bot_player_performance` and `bot_prop_type_performance` data
- Proven winners will get the +15 conviction boost when they appear in mispriced lines
- `player_blocks` will no longer be incorrectly suppressed (71% HR is strong)
- `player_steals` stays blocked statically as a safety net until it accumulates enough data for the dynamic system

### Note on Desmond Bane

Bane not appearing is expected behavior -- the force-fresh function only pulls from today's `mispriced_lines` table. If the analysis pipeline didn't flag any Bane props as mispriced today, no amount of bonus scoring can include him. The performance system correctly boosts winners **when they appear as candidates**, which will happen on game days with more lines available.


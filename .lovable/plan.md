

## Plan: High-Volume Parlay Engine + Telegram Strategy Announcement

### Part 1: High-Volume Parlay Variation Engine

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

**A. Triple tier counts (lines 665, 770, 830)**
- Exploration: 50 -> 150
- Validation: 15 -> 50
- Execution: 15 -> 40
- Target: ~240 parlays/day

**B. Reduce global player prop exposure cap (line 5738)**
- `MAX_GLOBAL_PLAYER_PROP_USAGE`: 5 -> 2
- Each player+prop combo can only appear in max 2 parlays across the entire slate

**C. Adjust per-tier player usage**
- Exploration `maxPlayerUsage`: 2 -> 3 (allows more combinations without same-player stacking within a parlay)
- Validation `maxPlayerUsage`: 2 -> 3
- Execution `maxPlayerUsage`: stays at 2 (strictest tier)

**D. Add shuffle variation profiles to each tier**

Add new profiles with `sortBy: 'shuffle'` to break deterministic selection patterns. These use the same strategies but shuffle the candidate pool to produce genuinely different combinations:

Exploration tier additions (~20 new profiles):
- 10x `mispriced_edge` with shuffle sort across NBA, NHL, all sports
- 5x `double_confirmed_conviction` with shuffle sort
- 5x `cross_sport` with shuffle sort

Validation tier additions (~15 new profiles):
- 8x `validated_conservative` / `validated_balanced` with shuffle sort
- 4x `mispriced_edge` with shuffle sort
- 3x `winning_archetype` with shuffle sort

Execution tier additions (~10 new profiles):
- 5x `cash_lock` / `boosted_cash` with shuffle sort
- 3x `golden_lock` with shuffle sort
- 2x `god_mode_lock` with shuffle sort

**E. Support 'shuffle' sortBy in generateTierParlays**
- In the candidate sorting logic, when `sortBy === 'shuffle'`, randomly shuffle the top candidates instead of deterministic sorting
- This ensures same-quality picks produce different combinations each time

### Part 2: Telegram Strategy Announcement

**New file: `supabase/functions/bot-announce-strategy-update/index.ts`**

Creates a one-time invocable edge function that:
1. Queries `bot_authorized_users` for all `is_active = true` customers
2. Sends a formatted Telegram message explaining:
   - Volume increase (200-300+ unique parlays daily)
   - Lower per-parlay stakes to manage exposure
   - Every pick cross-referenced across conviction analyzer, bot parlay validator, double-confirmed scanner
   - ~70% individual pick accuracy context
   - Strict player caps (max 2 appearances) to eliminate correlated losses
3. Sends messages sequentially with 100ms delays to respect Telegram rate limits
4. Returns success/failure count

**Config update: `supabase/config.toml`**
- Add `[functions.bot-announce-strategy-update]` with `verify_jwt = false`

### Expected Outcome

```text
Before: ~80 parlays/day, same players in 5+ parlays, correlated losses
After:  240+ parlays/day, max 2 appearances per player, uncorrelated outcomes
```

When 1 leg misses, only 2 parlays are affected instead of 5+. More unique combinations means higher chance of hitting 3/3 on at least some slips.


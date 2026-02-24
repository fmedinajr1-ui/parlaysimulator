

## Add `player_blocks` to Blocked Prop Types

A one-line addition to each file -- append `'player_blocks'` to the existing `BLOCKED_PROP_TYPES` set.

### Changes

**1. `supabase/functions/bot-generate-daily-parlays/index.ts` (line 432-434)**

```typescript
const BLOCKED_PROP_TYPES = new Set([
  'player_steals',   // 0% win rate (0-2 settled)
  'player_blocks',   // 0% win rate (0-7 settled)
]);
```

**2. `supabase/functions/bot-force-fresh-parlays/index.ts` (line 91)**

```typescript
const BLOCKED_PROP_TYPES = new Set(['player_steals', 'player_blocks']);
```

No other logic changes needed -- the existing filter code in both files already handles all entries in the set automatically.


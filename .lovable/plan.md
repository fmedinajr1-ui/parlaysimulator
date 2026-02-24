

## Block `player_blocks` Prop Type

Add `player_blocks` back to the static blocked prop types list in both generation functions.

### Changes

**1. `supabase/functions/bot-force-fresh-parlays/index.ts` (line 119)**

Update the static blocklist:
```typescript
const STATIC_BLOCKED_PROP_TYPES = new Set(['player_steals', 'player_blocks']);
```

**2. `supabase/functions/bot-generate-daily-parlays/index.ts` (lines 432-434)**

Update the static blocklist:
```typescript
const STATIC_BLOCKED_PROP_TYPES = new Set([
  'player_steals',
  'player_blocks',
]);
```

**3. Redeploy both edge functions** so the block takes effect immediately.


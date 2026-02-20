
## Fix PrizePicks Scraper for MLB Spring Training (MLBST)

### Root Cause

PrizePicks uses the league code `MLBST` (MLB Spring Training) instead of `MLB` during the pre-season. The scraper has three failures stemming from this:

1. `LEAGUE_TO_SPORT['MLBST']` is undefined → sport falls back to `'basketball_nba'` (wrong)
2. The context-aware `pitcher_strikeouts` mapping checks `league === 'MLB'` exactly → `'MLBST'` never matches, so `'Strikeouts'` / `'Ks'` stay as `player_strikeouts`
3. The `mlb-pitcher-k-analyzer` queries `pp_snapshot` where `sport = 'baseball_mlb'` → but these props land as `basketball_nba`, so zero results

The fix is three targeted changes in `pp-props-scraper/index.ts` and one cleanup in `mlb-pitcher-k-analyzer/index.ts`.

### Changes

**File: `supabase/functions/pp-props-scraper/index.ts`**

**1. Add `MLBST` (and other Spring Training / minor variants) to the league map** (line ~89)

```typescript
const LEAGUE_TO_SPORT: Record<string, string> = {
  'NBA': 'basketball_nba',
  'WNBA': 'basketball_wnba',
  'NHL': 'hockey_nhl',
  'NFL': 'americanfootball_nfl',
  'MLB': 'baseball_mlb',
  'MLBST': 'baseball_mlb',   // MLB Spring Training
  'ATP': 'tennis_atp',
  'WTA': 'tennis_wta',
  'PGA': 'golf_pga',
  'UFC': 'mma_ufc',
  'ESPORTS': 'esports',
};
```

**2. Broaden the context-aware MLB strikeout check** (line ~160)

Change:
```typescript
if (league === 'MLB' && proj.stat_type === 'Strikeouts') {
```
To:
```typescript
if ((league === 'MLB' || league === 'MLBST') && proj.stat_type === 'Strikeouts') {
```

**3. Add `MLBST` to the default sports array** (line ~204)

Change:
```typescript
const { sports = ['NBA', 'NHL', 'WNBA', 'ATP', 'WTA', 'MLB'] } = ...
```
To:
```typescript
const { sports = ['NBA', 'NHL', 'WNBA', 'ATP', 'WTA', 'MLB', 'MLBST'] } = ...
```

**File: `supabase/functions/mlb-pitcher-k-analyzer/index.ts`**

**4. Query `pp_snapshot` by `stat_type` only (not restricted to sport)** to catch both `baseball_mlb` and any mislabeled rows while the fix propagates:

Instead of:
```typescript
.eq('stat_type', 'pitcher_strikeouts')
.eq('is_active', true)
```
Add a sport filter that accepts both:
```typescript
.eq('stat_type', 'pitcher_strikeouts')
.eq('is_active', true)
.in('sport', ['baseball_mlb', 'basketball_nba'])  // temporary catch-all during transition
```

Actually, the cleaner fix is just to not filter by sport in the analyzer — since `stat_type = 'pitcher_strikeouts'` is unambiguous:
```typescript
.eq('stat_type', 'pitcher_strikeouts')
.eq('is_active', true)
// sport filter removed — pitcher_strikeouts is MLB-only by definition
```

### Execution After Deploy

1. Deploy `pp-props-scraper` and `mlb-pitcher-k-analyzer`
2. Run scraper with: `{ "sports": ["MLB", "MLBST"] }` to pull today's Spring Training props
3. Run analyzer: invoke `mlb-pitcher-k-analyzer` to cross-reference against historical logs
4. Check Telegram for the pitcher K report or use `/pitcherk` in the bot

### Files Changed

| Action | File | Change |
|--------|------|--------|
| Modify | `supabase/functions/pp-props-scraper/index.ts` | Add `MLBST` to league map, fix context check, add to default sports |
| Modify | `supabase/functions/mlb-pitcher-k-analyzer/index.ts` | Remove sport filter from `pp_snapshot` query |

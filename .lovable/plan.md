

## Unify Combo Prop Type Normalization Across Cross-Reference Engines

### Problem

Three edge functions use a naive `normalizePropType()` that only strips prefixes (`player_`, `batter_`, `pitcher_`) but does NOT unify combo aliases. This means:

- Engine A stores `points_rebounds_assists`, Engine B stores `pra` -- they never match
- `nba-mega-parlay-scanner` is even worse: it strips ALL underscores, turning `points_rebounds_assists` into `pointsreboundsassists`

The settle engine (`bot-settle-and-learn`) and the client-side veto utils (`parlayVetoUtils.ts`) already have the correct combo mapping, but the cross-reference engines don't.

### Solution

Replace the simple `normalizePropType` in all three functions with a unified version that maps combo aliases to canonical short forms.

### Canonical Mapping

```text
points_rebounds_assists, pts_rebs_asts, pra  -->  "pra"
points_rebounds, pts_rebs, pr                -->  "pr"
points_assists, pts_asts, pa                 -->  "pa"
rebounds_assists, rebs_asts, ra              -->  "ra"
three_pointers, threes_made, threes          -->  "threes"
(everything else: strip prefix, keep as-is)
```

### Files to Modify

**1. `supabase/functions/high-conviction-analyzer/index.ts` (line 16-18)**

Replace the current `normalizePropType`:
```typescript
function normalizePropType(raw: string): string {
  const s = raw.replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim();
  if (/points.*rebounds.*assists|pts.*rebs.*asts|^pra$/.test(s)) return 'pra';
  if (/points.*rebounds|pts.*rebs|^pr$/.test(s)) return 'pr';
  if (/points.*assists|pts.*asts|^pa$/.test(s)) return 'pa';
  if (/rebounds.*assists|rebs.*asts|^ra$/.test(s)) return 'ra';
  if (/three_pointers|threes_made|^threes$/.test(s)) return 'threes';
  return s;
}
```

**2. `supabase/functions/bot-force-fresh-parlays/index.ts` (line 16-18)**

Same replacement as above.

**3. `supabase/functions/nba-mega-parlay-scanner/index.ts` (line 21-23)**

Same replacement (removes the destructive underscore-stripping logic).

**4. Redeploy all three edge functions.**

### Impact

- High-conviction analyzer will now correctly match combo props across mispriced lines, risk engine, PropV2, sharp, and heat engines
- Force-fresh parlays will correctly cross-reference combo props against risk engine picks
- Mega parlay scanner will correctly look up combo props in sweet spots and mispriced maps
- No changes needed to `bot-settle-and-learn` or `parlayVetoUtils.ts` (already correct)


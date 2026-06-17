# Restrict parlay engine to 4 sports + run test send

## Goal
Lock the parlay engine (and downstream broadcasts) to only:
- **MLB** (`baseball_mlb`)
- **WNBA** (`basketball_wnba`)
- **Tennis** (`tennis_*` — any ATP/WTA/etc.)
- **Soccer — World Cup only** (`soccer_fifa_world_cup`, `soccer_fifa_world_cup_winner`)

Everything else (NFL, NCAAF, NHL, NBA, NCAAB, golf, MMA, other soccer leagues like Brazil/Copa Libertadores) gets filtered out before candidates enter the pool.

## Changes

### 1. New sport allowlist (single source of truth)
Add a constant + helper in `supabase/functions/parlay-engine-v2/index.ts`:

```ts
const ALLOWED_SPORTS = new Set([
  "baseball_mlb",
  "basketball_wnba",
  "soccer_fifa_world_cup",
  "soccer_fifa_world_cup_winner",
]);
const ALLOWED_PREFIXES = ["tennis_"]; // any tennis tour

function isAllowedSport(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const s = raw.toLowerCase();
  if (ALLOWED_SPORTS.has(s)) return true;
  return ALLOWED_PREFIXES.some(p => s.startsWith(p));
}
```

### 2. Apply at the source queries
The cron loads candidates from `unified_props` (and a couple of fallbacks) around lines 501 and 515. Add a sport filter directly to those Supabase queries using `.in("sport", [...])` plus a tennis `.or("sport.like.tennis_%")` clause, so we don't even pull rejected rows.

### 3. Defensive filter after normalization
After the per-row `sport` is resolved (lines 223 and 397-402 normalize values), drop any candidate where `isAllowedSport(rawSport)` is false. This catches any path the source filter misses (e.g., risk-engine fallback rows).

### 4. Same allowlist in sibling functions
Apply the identical filter in:
- `supabase/functions/cross-sport-parlay-generator/index.ts`
- `supabase/functions/cross-sport-sweet-spots/index.ts`
- `supabase/functions/bot-generate-straight-bets/index.ts`

Extract `isAllowedSport` into `supabase/functions/_shared/parlay-engine-v2/config.ts` (export `ALLOWED_SPORTS`, `isAllowedSport`) so all four functions share one list.

### 5. Mapping notes
Add a `mapping_notes` entry in the engine report:
`"sport_allowlist: mlb, wnba, tennis, soccer_fifa_world_cup (others dropped: N)"`

### 6. Test send after deploy
1. Deploy `parlay-engine-v2`, `cross-sport-parlay-generator`, `cross-sport-sweet-spots`, `bot-generate-straight-bets`.
2. Curl `POST /parlay-engine-v2` with `{"force":true, "dry_run":false}` for today's ET date.
3. If candidates > 0 and parlays built, the broadcaster fires automatically; verify via `bot_parlay_broadcasts` and Telegram.
4. If still 0 candidates, re-run against a recent date that has WNBA/MLB/tennis/WC rows to confirm the allowlist isn't over-restricting.

## Notes
- The DB currently shows mostly soccer rows in `unified_props` (Brazil + Libertadores + World Cup). After this change those non-WC soccer rows will be dropped, which is the intended behavior.
- The legacy strategy-name mapping (`lock_2`→`mispriced_edge`, etc.) and `PARLAY_ENGINE_V2_NEW` flag stay as-is.
- No DB schema change. No migration.

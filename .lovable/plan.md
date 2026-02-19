

# Full Defense Filter Audit — Complete Diagnosis

## What The Verification Proves

The manual trace against live database data has confirmed the entire defense filter chain end-to-end. Three things are true simultaneously:

**The good news:** `bdl_player_cache` is working — 727 mappings resolved, team names are correct.

**The bad news:** Two distinct failures are still preventing the filter from firing.

---

## Failure 1 — "LA Clippers" vs "Los Angeles Clippers" Name Mismatch (Still Breaking the Filter)

This is the surviving bug. The `defOpponentMap` is built from `game_bets` using full team names. `bdl_player_cache` stores the Clippers as `"LA Clippers"`. When the defense filter runs:

```
pick.team_name = "LA Clippers"
teamKey = "la clippers"
opponentMap.get("la clippers") → undefined   ← mismatch
rank = null
adj = 0
```

`game_bets` has `"Los Angeles Clippers"` — so the lookup misses. James Harden's threes pick should be **BLOCKED** (facing Denver Nuggets, rank 8 for threes = tough defense for an OVER), but instead gets `rank = null → passes by default`.

The database query proves it — this is the only team name mismatch across all 30 NBA teams.

**Fix:** Add a normalization step in the enrichment loop that converts `"LA Clippers"` → `"Los Angeles Clippers"` before the `opponentMap.get()` call. Or, more robustly, normalize both sides when building the `defOpponentMap` to strip "LA" → "Los Angeles".

---

## Failure 2 — `defense_adj` and `defense_rank` Are Not Written Back to Leg Records in the Database

Even when the filter resolves correctly (e.g. Donovan Mitchell vs Brooklyn Nets, rank 21 threes, +8 boost), the leg stored in `bot_daily_parlays` shows:

```
defense_adj: 0      ← should be +8 (soft defense)
defense_rank: null  ← should be 21
```

The composite score is adjusted in memory (`pick.compositeScore += adj`) but the leg serializer at line 5002-5005 writes `defense_rank: (pick as EnrichedMasterCandidate).defenseRank` — this only works for picks that went through `generateMasterParlay()`. The regular execution picks built by other strategies (premium_boost, sharp_ai, etc.) never get `defenseMatchupRank` written to their leg objects before serialization. So `defense_adj` and `defense_rank` are null on every stored leg even though the in-memory score was adjusted.

**Fix:** When serializing legs to the database, populate `defense_adj` and `defense_rank` from `(pick as any).defenseMatchupRank` and `(pick as any).defenseMatchupAdj` which ARE set during enrichment (line 3485-3486).

---

## What The Defense Filter Actually Does Today (Live Verification)

Manual trace of all 5 master parlay players against today's matchups:

| Player | Team | Opponent | Threes Rank | Filter Result | Should Be In Parlay? |
|---|---|---|---|---|---|
| Donovan Mitchell | Cleveland Cavaliers | Brooklyn Nets | 21 | PASSES (rank ≥ 17) | Yes — soft defense, valid OVER |
| Tyrese Maxey | Philadelphia 76ers | Atlanta Hawks | 27 | PASSES (rank ≥ 17) | Yes — very soft defense |
| Nickeil Alexander-Walker | Atlanta Hawks | Philadelphia 76ers | 17 | PASSES (rank = 17) | Yes — borderline soft |
| James Harden | LA Clippers | Denver Nuggets | 8 | Should be BLOCKED but passes due to name mismatch | No — tough defense, OVER should be filtered |
| Moses Moody | Golden State Warriors | Boston Celtics | 1 | BLOCKED (rank < 17) | No — hardest defense in league |

The current master parlay (`strategy_name: master_parlay_premium_boost`) was built by the fallback strategy, not the new `generateMasterParlay()` function. The new function requires 4+ valid candidates — with the name mismatch causing false passes and the wrong pool composition, the master parlay builder likely encountered issues and fell back.

---

## The Two Fixes Required

### Fix 1 — Normalize "LA Clippers" to "Los Angeles Clippers" in the team key lookup

In `bot-generate-daily-parlays/index.ts`, add a normalization helper that is applied whenever a `team_name` from `bdl_player_cache` is used as a lookup key against `game_bets`:

```typescript
function normalizeBdlTeamName(name: string): string {
  const fixes: Record<string, string> = {
    'la clippers': 'los angeles clippers',
  };
  const lower = (name || '').toLowerCase().trim();
  return fixes[lower] || lower;
}
```

Apply this at line 3479 (defOpponentMap lookup) and line 4944 (master parlay lookup):

```typescript
// Line 3479 — was: ((pick as any).team_name || '').toLowerCase().trim()
const teamKey = normalizeBdlTeamName((pick as any).team_name || '');

// Line 4944 — same fix
const teamLower = normalizeBdlTeamName((pick as any).team_name || '');
```

### Fix 2 — Write `defense_adj` and `defense_rank` back to stored legs

When the regular enrichment loop sets `(pick as any).defenseMatchupRank` and `(pick as any).defenseMatchupAdj`, those values need to flow through to the leg serializer. Find the leg serializer for non-master-parlay picks and add:

```typescript
defense_rank: (pick as any).defenseMatchupRank ?? null,
defense_adj: (pick as any).defenseMatchupAdj ?? 0,
```

---

## Files Changed

| File | Change | Line |
|---|---|---|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Add `normalizeBdlTeamName()` helper function | New function near line 4807 |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Apply normalizer at defOpponentMap lookup (composite enrichment) | Line 3479 |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Apply normalizer at master parlay candidate enrichment | Line 4944 |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Write `defense_rank` and `defense_adj` to stored leg records | Leg serializer in regular strategy builders |

---

## Expected Outcome After Fix

On the next generation run:

- James Harden threes OVER vs Denver (rank 8) gets blocked from master parlay
- Moses Moody threes OVER vs Boston (rank 1) gets blocked from master parlay  
- Remaining valid candidates: Mitchell (rank 21), Maxey (rank 27), Alexander-Walker (rank 17) — 3 clean OVER picks
- The master parlay builder will need to find 1+ more valid candidate to reach 4+ minimum, or correctly fail to build and leave it to the fallback
- Stored legs will show actual `defense_rank` and `defense_adj` values for the first time


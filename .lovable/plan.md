
# Defense Matchup Audit — Full Findings + Regeneration Plan

## Audit Result: Defense Filter IS Working in the Latest Run

The complete audit of today's parlays reveals a two-generation story:

### Generation 1 — 15:03 UTC (Before Fix)
- `playerTeamMap` sourced from `nba_player_game_logs` — 0 mappings (column did not exist)
- All legs: `defense_rank: null`, `defense_adj: 0`
- James Harden (vs Denver, rank 8), Moses Moody (vs Boston, rank 1) incorrectly included
- Filter was completely inert — every pick bypassed by default

### Generation 2 — 15:37 UTC (After Fix)
- `playerTeamMap` sourced from `bdl_player_cache` — 727 mappings resolved
- All 6 master parlay legs have valid defense ranks written to the database
- Filter is fully operational

**Every leg in today's master parlay is verified clean:**

| Player | Opponent | Prop | Defense Rank | Gate (≥17) |
|---|---|---|---|---|
| Tyrese Maxey | Atlanta Hawks | Threes OVER | **27** | PASS |
| Aaron Nesmith | Washington Wizards | Threes OVER | **30** | PASS |
| Paolo Banchero | Sacramento Kings | Assists OVER | **28** | PASS |
| Josh Hart | Detroit Pistons | Assists OVER | **25** | PASS |
| Donovan Mitchell | Brooklyn Nets | Threes OVER | **21** | PASS |
| Nikola Vucevic | Toronto Raptors | Assists OVER | **20** | PASS |

## One Remaining Issue Found: Non-Master-Parlay Strategies Still Have Partial Coverage

The audit of defense metadata across all strategies reveals that non-master strategies are inconsistently enriched:

| Strategy | Total Legs | With Defense Rank | Missing Rank |
|---|---|---|---|
| master_parlay_premium_boost | 12 | 6 (latest run) | 0 (latest) |
| premium_boost_execution_hot_streak_lock | 27 | 3 | 24 |
| premium_boost_exploration_explore_mixed | 24 | 5 | 19 |
| premium_boost_exploration_cross_sport | 24 | 5 | 19 |
| premium_boost_execution_hot_streak_lock_cross | 12 | 0 | 12 |

The non-master execution strategies were generated in the 15:03 run (before the fix) with null defense data, and they were not regenerated in the 15:37 run. This means legs like:

- **Onyeka Okongwu** (ATL Hawks) — Threes OVER vs PHI 76ers (PHI threes rank = **17**, borderline pass) — defense_rank: null
- **Kyshawn George** (Washington Wizards) — Assists OVER vs Indiana Pacers (WAS is the HOME team; IND assists rank = **15**, should be BLOCKED for an OVER pick) — defense_rank: null, incorrectly included
- **Amen Thompson** (Houston Rockets) — Rebounds UNDER vs Charlotte Hornets (HOU rebounds rank = **2**, very tough = rank ≤15 needed for UNDER, which it satisfies, but this is not captured)

These picks are in published parlays but were scored without defense context.

## What the Regeneration Does

A `force_regenerate: true` run at this point will:
1. Clear all today's parlays (both generations)
2. Re-run the full pipeline with `bdl_player_cache` as the team map source (727 mappings)
3. Apply the `normalizeBdlTeamName()` fix for LA Clippers
4. Write `defense_rank` and `defense_adj` to every NBA leg across ALL strategies
5. Re-run `generateMasterParlay()` which has already proven it builds correctly (15:37 run)

## Technical Changes Required

### No code changes needed — the function is already fixed. The action is to trigger a clean regeneration.

The bot-generate-daily-parlays function is deployed with all three fixes:
- `bdl_player_cache` as the playerTeamMap source (727 mappings)
- `normalizeBdlTeamName()` applied at both lookup sites
- `defense_rank` / `defense_adj` written to all serialized legs

### Action: Trigger force_regenerate

Call `bot-generate-daily-parlays` with:
```json
{
  "action": "generate",
  "force_regenerate": true,
  "date": "2026-02-19"
}
```

This will:
1. Delete all today's parlays in bot_daily_parlays
2. Re-build from the fixed pipeline
3. All NBA legs across all strategies will have correct defense metadata
4. The master parlay will be re-built with the defense gate enforced

## Expected Outcome

After regeneration:
- Every NBA leg in every strategy will show `defense_rank` and `defense_adj` populated
- The master parlay will be re-built with 6 clean legs (same players are likely to be selected since their matchups are genuinely favorable)
- Kyshawn George assists OVER (vs IND assists rank 15) will be filtered out of master parlay consideration since rank 15 < 17 threshold
- Execution strategies will have full defense context for every NBA player prop

## Files to Change

No code changes needed. The edge function is already correct. This plan triggers a runtime regeneration call via `curl_edge_functions`.

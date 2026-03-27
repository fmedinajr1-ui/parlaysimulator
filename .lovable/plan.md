

# Fix Pipeline Quality Issues — 4 Items

## 1. Fix Ghost Legs (no player_name)

**Root cause**: The main leg assembly (line ~8439) copies `playerPick.player_name` into `legData`, but some picks from mispriced/team sources may have null player names and still pass through. The cluster builder (line ~10498) and other builders also lack validation.

**Fix**: Add a hard gate in `bot-generate-daily-parlays/index.ts` immediately before `legs.push(legData)` at every push site:
- If `!legData.player_name` (for player-type legs), skip with a log: `[GhostBlock] Skipped leg with no player_name`
- Apply the same check in the cluster builder (~10498), sweep builder (~11139), and all other `legs.push` / `selectedLegs.push` sites
- Also add a final sanitization pass before inserting parlays: filter out any leg where `type !== 'team' && !player_name`

**Files**: `supabase/functions/bot-generate-daily-parlays/index.ts`

## 2. Cap Rebounds — Max 1 Per Parlay

**Fix**: At each `legs.push` site, check the prop type count tracker (`parlayPropTypeCount`) for `player_rebounds`. If it's already at 1, skip the leg.

Specifically, right before `legs.push(legData)` (~line 8543), add:
```
const normProp = normalizePropType(legData.prop_type || '');
if (normProp === 'player_rebounds' && (parlayPropTypeCount.get('rebounds') || 0) >= 1) {
  console.log(`[ReboundCap] Blocked ${legData.player_name} — max 1 rebound leg per parlay`);
  continue;
}
```

Apply the same cap in cluster builder, sweep builder, and all sub-builders (sharp, heat, lottery scanner).

**Files**: `bot-generate-daily-parlays/index.ts`, `nba-mega-parlay-scanner/index.ts`, `sharp-parlay-builder/index.ts` (if applicable), `bot-force-fresh-parlays/index.ts`

## 3. Block Steals & Blocks From Parlays

**Fix**: Add a `BLOCKED_PARLAY_PROPS` set at the top of the generator:
```
const BLOCKED_PARLAY_PROPS = new Set(['player_steals', 'player_blocks']);
```

Before each `legs.push`, check:
```
if (BLOCKED_PARLAY_PROPS.has(normalizePropType(legData.prop_type || ''))) {
  console.log(`[VolatileBlock] Blocked ${legData.player_name} ${legData.prop_type} — steals/blocks banned from parlays`);
  continue;
}
```

Apply in all parlay builders. Straight bets can still use them (no change to `bot-generate-straight-bets`).

**Files**: `bot-generate-daily-parlays/index.ts`, `nba-mega-parlay-scanner/index.ts`, `bot-force-fresh-parlays/index.ts`

## 4. DNA Audit Must Run Every Day — Never Skip

**Problem**: The DNA audit (phase3g) gets skipped when the orchestrator times out before reaching it, and there's no recovery mechanism specifically for the audit.

**Fix** in `refresh-l10-and-rebuild/index.ts`:
- After the main phase loop ends, check if `results["score-parlays-dna"]` exists and equals `"ok"`. If not (skipped or failed), force-invoke it one more time as a standalone call outside the loop, with its own try/catch
- Send an admin alert if the DNA audit was skipped and the recovery also fails
- This ensures the audit runs even if earlier phases consumed the timeout budget

```
// After main loop, before auto-resume logic (~line 418)
if (results["score-parlays-dna"] !== "ok") {
  log("⚠ DNA audit did not complete — forcing standalone run");
  try {
    const dnaResp = await supabase.functions.invoke("score-parlays-dna", { body: {} });
    results["score-parlays-dna"] = "ok:forced";
    log("✅ Forced DNA audit completed");
  } catch (e) {
    results["score-parlays-dna"] = `forced_error:${e.message}`;
    sendPipelineAlert(`🚨 *DNA Audit Failed*\n\nForced DNA audit after timeout also failed.\n*Error:* ${e.message}`);
  }
}
```

**Files**: `supabase/functions/refresh-l10-and-rebuild/index.ts`

## Summary of Files Changed
1. `supabase/functions/bot-generate-daily-parlays/index.ts` — Ghost leg gate, rebound cap, steals/blocks block
2. `supabase/functions/nba-mega-parlay-scanner/index.ts` — Rebound cap, steals/blocks block
3. `supabase/functions/bot-force-fresh-parlays/index.ts` — Rebound cap, steals/blocks block
4. `supabase/functions/refresh-l10-and-rebuild/index.ts` — Forced DNA audit fallback


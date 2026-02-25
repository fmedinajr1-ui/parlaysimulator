

## Fix Pipeline Bugs and Rerun Full Slate Generation

### 3 Critical Bugs Found

#### Bug 1: `bot-generate-daily-parlays` is NEVER called in Phase 3 (Generation)
The main parlay generator (responsible for 73/97 parlays on Feb 23) is only called once in Phase 2 with `source: 'mlb_pipeline'`. Phase 3 skips it entirely -- it only runs `bot-force-fresh-parlays` and `bot-review-and-optimize`.

**Fix:** Add `bot-generate-daily-parlays` to Phase 3 BEFORE `bot-force-fresh-parlays`.

#### Bug 2: `bot-force-fresh-parlays` VOIDS all existing parlays before generating
Lines 82-87 run `UPDATE bot_daily_parlays SET outcome = 'void'` on ALL pending parlays for today. So even if `bot-generate-daily-parlays` ran first, force-fresh would destroy its output and only produce 8 replacements.

**Fix:** Remove the void step. Force-fresh should ADD parlays, not replace them.

#### Bug 3: `bot-force-fresh-parlays` caps at MAX_PARLAYS = 8
On Feb 23 it produced 24. The hardcoded cap of 8 limits volume.

**Fix:** Increase `MAX_PARLAYS` from 8 to 25 and remove the steals/blocks static block (matching the relaxed filters from the earlier plan).

### Changes

#### File 1: `supabase/functions/data-pipeline-orchestrator/index.ts`
- Add `bot-generate-daily-parlays` call in Phase 3 (Generation), right after the preflight check and targeted scrape, BEFORE `bot-force-fresh-parlays`

#### File 2: `supabase/functions/bot-force-fresh-parlays/index.ts`
- **Remove lines 81-90**: Delete the void step that destroys existing parlays
- **Line 187**: Change `MAX_PARLAYS = 8` to `MAX_PARLAYS = 25`
- **Line 125**: Clear `STATIC_BLOCKED_PROP_TYPES` (remove steals/blocks to match relaxed filters)

### Expected Pipeline Flow After Fix
1. Preflight check
2. Targeted odds refresh
3. `bot-generate-daily-parlays` -- produces 50-70 parlays (exploration + validation + execution tiers)
4. `bot-force-fresh-parlays` -- ADDS 15-25 force_mispriced_conviction parlays on top
5. `bot-review-and-optimize` -- final quality pass

### Expected Volume: 65-95 parlays (matching Feb 23)

### After deploying, trigger the pipeline with `mode: 'generate'` to produce today's full slate.


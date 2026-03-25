

# Wire DNA Scorer as Mandatory Post-Generation Step

## Current State

- `score-parlays-dna` already runs in Phase 3d of the orchestrator and voids/prunes parlays
- But it does **not persist the grade** — no `dna_grade` column exists on `bot_daily_parlays`
- The frontend and other pipeline steps have no visibility into which grade a parlay received
- Sharp/heat parlays generated *after* the DNA audit (Phase 3d/3e) never get scored

## Changes

### 1. Add `dna_grade` column to `bot_daily_parlays`
- Migration: `ALTER TABLE bot_daily_parlays ADD COLUMN dna_grade text;`
- Nullable — older parlays stay null, new ones get A/B/C/F

### 2. Update `score-parlays-dna/index.ts`
- After grading each parlay, persist the grade: update `dna_grade` on every scored parlay (not just voided/pruned ones)
- Batch update all A/B/C grades alongside existing void/prune logic

### 3. Move DNA audit after ALL generators in orchestrator
- Currently Phase 3d runs DNA audit **before** sharp-parlay-builder and heat-prop-engine generate new parlays
- Restructure so DNA audit runs **after** all generators (sharp, heat, ladder, diversity) as a final gate
- New phase ordering in `refresh-l10-and-rebuild/index.ts`:
  - Phase 3c: Wide generate + curated + force fresh (unchanged)
  - Phase 3d: Sharp + heat scan (parallel) — move existing generators here
  - Phase 3e: Heat build (unchanged)
  - Phase 3f: Ladder + diversity (unchanged)
  - **Phase 3g (new): DNA audit** — scores ALL pending parlays including sharp/heat/ladder
  - Phase 3h: Slate status (was 3g)

### 4. Update frontend hook `useBotPipeline.ts`
- Add `dna_grade` to `PipelineParlay` interface so the UI can display grades

## Files Changed

1. **Migration** — Add `dna_grade text` column to `bot_daily_parlays`
2. **`supabase/functions/score-parlays-dna/index.ts`** — Persist grade to `dna_grade` column on every parlay
3. **`supabase/functions/refresh-l10-and-rebuild/index.ts`** — Move DNA audit to final post-generation phase
4. **`src/hooks/useBotPipeline.ts`** — Add `dna_grade` to interface


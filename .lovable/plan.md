

## Fix Plan: Exposure Caps, Tier Sizing, Volume Mode

### Change 1: Enforce Exposure Cap Inside Generation

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

Currently at lines 9677-9697, existing parlays are loaded but only used for fingerprint dedup — `globalSlatePlayerPropUsage` is reset to empty (line 9684). This means each generation run has zero awareness of how many times a player-prop combo already appears in pending parlays.

**Fix**: After loading existing parlays for fingerprint dedup, also count player-prop-side appearances and pre-populate `globalSlatePlayerPropUsage`. Then enforce a hard cap of 3 in the leg selection logic — any pick already appearing in 3+ pending parlays gets blocked.

```text
Existing flow:
  existingParlays → fingerprints only → usage maps reset

New flow:
  existingParlays → fingerprints + count player-prop-side usage
  → pre-populate globalSlatePlayerPropUsage with counts
  → hard cap check: if usage >= 3, skip pick
```

### Change 2: Cap Execution Tier at 3 Legs Max

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

Lines 1005-1011 contain 5-leg and 8-leg role-stacked profiles in the execution tier:
```
{ legs: 5, strategy: 'role_stacked_5leg', ... }  // line 1008
{ legs: 5, strategy: 'role_stacked_5leg', ... }  // line 1009
{ legs: 8, strategy: 'role_stacked_8leg', ... }  // line 1010
{ legs: 8, strategy: 'role_stacked_8leg', ... }  // line 1011
```

Also lines 925, 967-976 have 4-leg profiles (`optimal_combo` 4-leg, `sweet_spot_plus` 4-leg) in execution.

**Fix**: 
- Remove 5-leg and 8-leg profiles from execution entirely
- Move 4-leg `sweet_spot_plus` profiles to exploration tier
- Keep 4-leg `cross_sport_4` in execution (8-0 proven record) but everything else capped at 3

### Change 3: Exposure Dedup in Quality Regen Loop

**File**: `supabase/functions/bot-quality-regen-loop/index.ts`

After the existing fingerprint dedup block (lines 215-260), add an exposure dedup pass that counts player-prop-side appearances across all remaining pending parlays. For any combo exceeding 3 appearances, void the lowest-probability excess parlays.

### Change 4: Disable Volume Mode Player Usage Relaxation

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

Line 9708: `TIER_CONFIG.exploration.maxPlayerUsage = 4;`

**Fix**: Remove this line. Keep `maxPlayerUsage = 1` even in volume mode. Only relax team and category caps.

### Summary of Edits

| File | Lines | Change |
|------|-------|--------|
| `bot-generate-daily-parlays/index.ts` | 9677-9697 | Pre-load player-prop-side usage from existing pending parlays, enforce cap of 3 |
| `bot-generate-daily-parlays/index.ts` | 1005-1011 | Remove 5-leg and 8-leg profiles from execution |
| `bot-generate-daily-parlays/index.ts` | 925, 967-976 | Move 4-leg sweet_spot_plus to exploration |
| `bot-generate-daily-parlays/index.ts` | 9708 | Remove `maxPlayerUsage = 4` from volume mode |
| `bot-quality-regen-loop/index.ts` | ~260 | Add exposure dedup pass after fingerprint dedup |


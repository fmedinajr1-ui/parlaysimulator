

## Fix: Zero-Parlay Problem on Subsequent Runs

### Root Cause Analysis

After investigating the generation logs, here's why the run produced 0 parlays despite 49 picks in the pool:

1. **4-leg profiles can only build 3 legs** - With only NBA picks available tonight (no NHL, tennis, or NCAAB player props), the BufferGate (projection buffer < 1.0), team-per-parlay limits, and category caps prevent building a 4th unique leg. This causes 20+ profiles to fail immediately.

2. **3-leg profiles hit existing fingerprints** - The 13 existing parlays from earlier runs already cover the viable 3-leg combos. Since the combinator always sorts and picks the highest-weighted candidates first, it deterministically generates the same combinations.

3. **Mirror fingerprint too aggressive** - Even parlays with the same players but different lines or strategies are blocked.

4. **No fallback** - A 4-leg profile that builds 3 good legs is thrown away entirely instead of being kept as a valid 3-leg parlay.

### Fixes (all in `bot-generate-daily-parlays/index.ts`)

**Fix 1: Allow 4-Leg Profiles to Fall Back to 3 Legs**

At line 4814, where it checks `if (legs.length < profile.legs)`, add a fallback:
- If a profile wants 4 legs but only got 3, accept it as a valid 3-leg parlay instead of discarding
- Only allow this fallback when the pool is small (< 60 player picks) to maintain quality on big slates
- Tag these as `strategy_name + '_fallback3'` for tracking

**Fix 2: Strategy-Aware Fingerprints**

The fingerprint currently only uses player/prop/side/line. Two different strategies generating the same combination get blocked. Change the fingerprint to include the strategy name so `explore_safe` and `explore_balanced` can each have the same leg combo:
- Modify `createParlayFingerprint` to optionally include strategy
- Keep cross-strategy exact-duplicate blocking for the same tier (execution) but allow it for exploration tier

**Fix 3: Add Randomization to Candidate Selection**

The combinator always picks the highest-weighted candidate first, producing deterministic output. Add a controlled shuffle:
- For exploration tier, shuffle the top 70% of candidates before selection (preserving quality floor while introducing variety)
- This ensures each run produces different combinations even from the same pool

**Fix 4: Remove Mirror Fingerprint Blocking for Cross-Run Dedup**

Mirror fingerprints are useful within a single run to prevent "same game, flipped sides" pairs. But blocking them across runs is too aggressive:
- Only populate `globalMirrorPrints` from parlays generated in the current run, not from pre-loaded existing parlays
- Pre-loaded parlays only block exact fingerprints

### Technical Details

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

**Change 1 - Fallback to 3 legs** (around line 4813-4815):
```typescript
// Current: discard if legs < profile.legs
// New: accept 3-leg fallback when pool is small
if (legs.length < profile.legs) {
  if (legs.length >= 3 && pool.playerPicks.length < 60) {
    // Accept as 3-leg fallback
    console.log(`[Bot] ${tier}/${profile.strategy}: accepting ${legs.length}-leg fallback (pool too small for ${profile.legs})`);
  } else {
    console.log(`[Bot] ${tier}/${profile.strategy}: only ${legs.length}/${profile.legs} legs built`);
    continue; // skip as before
  }
}
```

**Change 2 - Strategy-aware fingerprints** (line 4845):
```typescript
// Include strategy in fingerprint for exploration tier to allow same combo under different strategies
const fpStrategy = tier === 'exploration' ? profile.strategy : '';
const fingerprint = createParlayFingerprint(legs) + (fpStrategy ? `||S:${fpStrategy}` : '');
```

**Change 3 - Candidate shuffle** (before the candidate selection loop, around line 4500):
```typescript
// Shuffle top candidates for exploration tier to avoid deterministic output
if (tier === 'exploration') {
  const shuffleCount = Math.floor(remainingCandidates.length * 0.7);
  const topSlice = remainingCandidates.slice(0, shuffleCount);
  for (let i = topSlice.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [topSlice[i], topSlice[j]] = [topSlice[j], topSlice[i]];
  }
  remainingCandidates = [...topSlice, ...remainingCandidates.slice(shuffleCount)];
}
```

**Change 4 - Mirror prints only for current run** (line 6342-6357):
```typescript
// Only pre-load exact fingerprints from existing parlays (not mirrors)
// Mirrors are populated during THIS run only
const globalFingerprints = new Set<string>();
const globalMirrorPrints = new Set<string>(); // starts empty, filled during this run

if (existingParlays?.length) {
  for (const p of existingParlays) {
    const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs);
    globalFingerprints.add(createParlayFingerprint(legs));
    // DO NOT add mirror prints from existing parlays
  }
}
```

### Expected Impact

- 4-leg profiles that build 3 legs will now produce parlays instead of being discarded (recovers ~15 parlays per run)
- Candidate shuffling ensures each run generates different combinations (avoids deterministic fingerprint collisions)
- Strategy-aware fingerprints allow the same good combo to appear under different strategy tags
- Mirror dedup is scoped to within-run only, preventing cross-run over-blocking
- Combined effect: each run should produce 8-15 new parlays, scaling to 40-60+ across daily cron runs

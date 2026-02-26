

## Fix: Sharp Builder, Heat Engine, and Strategy Diversity (3 Issues)

### Issue 1: Sharp Parlay Builder receives no action

The Clean & Rebuild step 10 calls `sharp-parlay-builder` with no body. The function requires `{ action: 'build' }` to work.

**File: `src/components/market/SlateRefreshControls.tsx`**
- Change step 10 from `{ name: 'Building sharp parlays', function: 'sharp-parlay-builder' }` to include the body: `{ name: 'Building sharp parlays', function: 'sharp-parlay-builder', body: { action: 'build' } }`
- Also fix the quick-refresh steps array (line ~24) which has the same missing body issue

### Issue 2: Heat Engine called without build action

The heat-prop-engine runs in `fetch` mode (read-only) instead of generating parlays. It needs the correct action parameter.

**File: `src/components/market/SlateRefreshControls.tsx`**
- Change step 11 from `{ name: 'Building heat parlays', function: 'heat-prop-engine' }` to `{ name: 'Building heat parlays', function: 'heat-prop-engine', body: { action: 'build' } }`
- Same fix for the quick-refresh steps array

### Issue 3: Strategy diversity not enforced

12 of 19 parlays (63%) are `mispriced_edge`, violating the 30% cap. The cap logic in `bot-generate-daily-parlays` needs investigation.

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**
- Review the strategy diversity cap logic to confirm it enforces the 30% maximum per strategy
- The cap log shows "max 15 parlays per strategy (30% of 50)" which means the cap is 15 for a 50-target run -- but only 19 parlays were generated total, and 12 are the same strategy
- The issue is the cap is calculated against the target (50) not the actual output. If only 19 are generated, 12/19 = 63% even though 12 is under the cap of 15
- Fix: Add a post-generation pass that trims any strategy exceeding 30% of the ACTUAL output, voiding excess parlays from overrepresented strategies

### Expected Result
- Sharp parlays actually get built (adding 3-5 more pending parlays)
- Heat parlays actually get built (adding 2-4 more pending parlays)  
- No single strategy exceeds 30% of the final slate
- Total pending parlays should reach 25-30 with proper diversity


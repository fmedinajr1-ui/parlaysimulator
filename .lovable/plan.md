

The user wants the bot to feel smarter and more human-like, AND act like a portfolio manager — looking at the day's available picks and deciding which ones to actually bet (and at what stake size) to protect bankroll. Right now after Phase 3 we have:

- `bot_daily_picks` populated by 4 generators with confidence scores, edge%, tier
- A `voice.ts` module with greetings, verdicts, callbacks, phrase rotation
- An orchestrator that just dispatches phase messages — it doesn't curate or stake

What's missing:
1. **A bankroll selector** — something that reads all locked picks for today, ranks them, applies risk-of-ruin logic, and chooses which to "approve for play" with specific stake amounts
2. **Voice depth** — current voice module is decent but generic; needs more personality variants, situational awareness (hot streak vs cold streak), opinion strength scaling, and self-reference
3. **Stake-aware messaging** — the pick formatter shows confidence but doesn't say "I'm putting $300 on this" vs "$50 dart throw"

Let me check what's currently in the picks table, the daily profit projector logic (already has stake tiers), and what bankroll state we track.

# Smarter Bot: Bankroll Curator + Personality Upgrade

## What I'll build

### 1. New shared lib: `_shared/bankroll-curator.ts`
The brain that turns raw picks into a staked playcard.

**Logic:**
- Pull all `bot_daily_picks` with `status='locked'` for today
- Pull last 7 days of settled results to detect current form (hot/cold/neutral)
- Tier each pick into one of three buckets matching the existing Profit Projector:
  - **Execution** (`tier='elite'`, conf ≥80, edge ≥6%) → $300 stake, max 5/day
  - **Validation** (`tier='high'`, conf 70-79, edge ≥4%) → $150 stake, max 8/day
  - **Exploration** (`tier='medium'`, conf 60-69) → $50 stake, max 10/day
- Apply **bankroll guards**:
  - If last 3 days lost >15% → drop all stakes 50% ("cooling off")
  - If 2+ picks correlate (same game, same team) → keep only the highest-confidence one
  - Cap total daily exposure at 20% of bankroll (read from new `bot_bankroll_state` table, default $5000)
  - Skip any pick where line moved against us >10% since generation
- Mark approved picks with `status='approved'` and write `stake_amount`, `bankroll_reason`
- Mark skipped picks with `status='passed'` and write a `pass_reason` ("correlated with X", "cold streak — sitting this out", "edge eroded")

### 2. New table: `bot_bankroll_state`
- `current_bankroll` (default 5000)
- `starting_bankroll`, `peak_bankroll`
- `daily_max_exposure_pct` (default 20)
- `current_form` enum: hot/neutral/cold/ice_cold (auto-updated nightly)
- `last_updated`

### 3. Add columns to `bot_daily_picks`
- `stake_amount` numeric
- `stake_tier` text ('execution' | 'validation' | 'exploration')
- `bankroll_reason` text (why we played it)
- `pass_reason` text (why we skipped it)
- Update `status` enum to add `'approved'` and `'passed'`

### 4. Upgrade `_shared/voice.ts` with personality depth
Extend existing module — keep current API, add:
- **Form-aware openings**: hot streak → "Riding hot. 7 of last 10 cashed.", cold → "Tightening up after a rough patch."
- **Stake-language**: "I'm putting real money behind this — $300" / "Toe in the water at $50, just enough to track"
- **Self-reference**: "Said this morning that ATL's defense was the play. Doubling down."
- **Conviction scaling** (replace current flat `confidenceWord`): 
  - 90+: "This is the highest conviction play I've had in a week"
  - 80-89: "I'm all over this"
  - 70-79: "Strong lean, sized accordingly"
  - 60-69: "Worth a small stake to see"
- **Skip explanations** (new): "Passed on Curry under — correlated with the Warriors team total I already played"
- **Rotating signature signoffs** by time of day (morning: "Let's eat.", evening: "Lights out.")

### 5. New edge function: `bankroll-curator`
- Runs after generators (add to orchestrator or its own cron at :05 past each generator hour)
- Calls bankroll-curator lib
- Writes approved/passed status back to picks
- Returns summary: "Approved 7 picks, $1,650 total exposure, passed 12 (3 cold-streak cuts, 5 correlated, 4 edge erosion)"

### 6. Update `_shared/pick-formatter.ts`
- `renderPickCard` shows stake amount prominently: `💵 Stake: $300 (Execution tier)`
- Add `renderPlaycard(approvedPicks)` — a single message that lists today's chosen plays with stakes, total exposure, and bankroll reasoning at top
- Add `renderPassedSummary(passedPicks)` — short list of what we skipped and why (transparency builds trust)

### 7. Update orchestrator phases
- **dawn_brief**: now references bankroll state ("Starting today at $5,247, +$247 on the week. Looking to add to it.")
- **pick_drops**: calls `renderPlaycard` instead of dumping all picks — only shows approved picks with stakes
- **settlement_story**: updates `bot_bankroll_state.current_bankroll` with day's P&L, recalculates form streak

## Files touched

**Create:**
- `supabase/functions/_shared/bankroll-curator.ts`
- `supabase/functions/bankroll-curator/index.ts`

**Modify:**
- `supabase/functions/_shared/voice.ts` (extend, don't replace)
- `supabase/functions/_shared/pick-formatter.ts` (add 2 functions, update card)
- `supabase/functions/orchestrator-daily-narrative/index.ts` (use playcard + bankroll context)

**DB migration:**
- New table `bot_bankroll_state` (1 row, RLS service-role only) + seed row at $5000
- Add 4 columns to `bot_daily_picks`
- Add cron: `bankroll-curator` runs every 30 min during pick generation hours (10a-7p ET)

## Risk + rollback
- **Risk**: bankroll-curator could be too aggressive and skip everything. Mitigation: hard floor of 1 approved pick per day if any locked picks exist, plus a `force_approve_all` flag for the first day to A/B compare.
- **Rollback**: orchestrator falls back to old behavior if `bot_bankroll_state` is missing; new columns are nullable.

## Testing (project policy: 5 verifications)
1. Seed 10 fake picks across all 3 tiers, run curator → verify correct stake assignment
2. Simulate cold streak (insert 5 losses) → verify stakes drop 50%
3. Insert correlated picks (same player, both sides) → verify only one survives
4. Force `force_approve_all` → verify all picks get default stakes
5. Run dawn_brief → verify bankroll opening line renders with real numbers
6. Run pick_drops → verify playcard shows stakes + reasoning, not raw pick list

## What does NOT change
- Generators stay as-is (they still write `locked` picks)
- Compat shim still active for legacy `{type, data}` callers
- Frontend, blog, settlement engine, hedge tracker — zero touch this loop


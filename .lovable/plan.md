

User wants existing users (admin + customer) brought into the new personalization system. Right now after Phase 6:
- New `/start` triggers onboarding wizard ✅
- But existing rows in `bot_authorized_users` got seeded as `legacy_skip` → they bypass the router and keep getting everything generic
- Admin users specifically need the full personalization too so they can dogfood it

Let me check the seed migration and current auth table.
- Phase 6 migration set existing users to `onboarding_step='legacy_skip'`
- `customer-pick-router.ts` short-circuits on `legacy_skip` → returns `{shouldSend: true}` with no personalization
- Result: nobody currently gets personalized stakes/filtering except brand-new signups

Need to: (a) trigger onboarding for everyone already in the system, (b) treat admins identically (they're customers too).

# Re-onboard All Existing Users (Admin + Customer)

## What I'll do

### 1. Migration: flip everyone to `awaiting_bet_type`
Update `bot_user_preferences`:
- All rows currently at `legacy_skip` → `awaiting_bet_type`
- Backfill `bot_user_preferences` rows for any `bot_authorized_users` that don't have one yet (admins included)
- Reset `onboarding_completed_at = null`

### 2. New edge function: `bot-reonboard-existing`
One-shot broadcaster. For every user with `onboarding_step != 'complete'`:
- Send a friendly "we upgraded — quick 30-second reset" message
- Fire onboarding step 1 (bet type buttons)
- Stagger sends 100ms apart to respect Telegram rate limits
- Idempotent: skip users already mid-flow (`onboarding_step` not in `legacy_skip` / `awaiting_bet_type`)

Message template:
> "Heads up 👋 I just got smarter. Now I personalize picks per person — your sports, your bankroll, your stake sizes. 30 seconds to set up, then I stop sending you stuff you'd mute. Ready?
> 
> [🎯 Singles] [🎰 Parlays] [🔥 Both]"

### 3. Treat admins as customers
- Remove the `legacy_skip` bypass in `customer-pick-router.ts` — once everyone has real prefs, the bypass is dead code
- Keep the `DISABLE_PERSONALIZATION=true` env flag as the single rollback lever
- Admins get the same onboarding flow (no special-casing); they can pick `aggressive` to see everything

### 4. Add `/reonboard` command
Lets any user re-trigger the wizard from scratch (sets their step back to `awaiting_bet_type`). Useful if someone closes the app mid-flow.

### 5. Webhook: handle nudges
If a user hasn't responded to onboarding step 1 within 24 hours, the next pick fanout will detect `onboarding_step != 'complete'` and silently skip them — but every 3 days a gentle nudge re-fires the current step's prompt. Implemented as a daily cron on the existing orchestrator.

## Files touched

**Create:**
- `supabase/functions/bot-reonboard-existing/index.ts`

**Modify:**
- `supabase/functions/_shared/customer-pick-router.ts` — remove `legacy_skip` bypass, add 3-day nudge logic
- `supabase/functions/telegram-webhook/index.ts` — add `/reonboard` command
- `supabase/functions/orchestrator-daily-narrative/index.ts` — add nightly nudge phase

**DB (insert tool, not migration — data update):**
- Update existing `bot_user_preferences` rows from `legacy_skip` → `awaiting_bet_type`
- Insert `bot_user_preferences` rows for any `bot_authorized_users` missing one

## Execution

After deploy, manually invoke `bot-reonboard-existing` once. It returns `{ sent: N, skipped: M }`. Subsequent picks are personalized for anyone who completes the flow.

## Risk + rollback

- **Risk**: blast all users with a message they didn't ask for. Mitigation: one-time only (idempotent flag), friendly tone, takes <30 sec.
- **Risk**: someone ignores onboarding → stops getting picks. Mitigation: 3-day nudge + `/reonboard` command + `DISABLE_PERSONALIZATION=true` rollback restores Phase 5 behavior instantly.

## Testing (5 verifications)

1. Run migration → verify all `legacy_skip` rows flipped to `awaiting_bet_type`
2. Invoke `bot-reonboard-existing` → verify message + buttons sent to test admin chat
3. Test admin completes flow → verify personalized stakes appear in next alert
4. Send `/reonboard` from completed user → verify wizard restarts
5. Set `DISABLE_PERSONALIZATION=true` → verify everyone gets unfiltered alerts again

## What does NOT change

- Generators, frontend, blog, settlement, hedge, Phase 4/5 enrichment — zero touch
- Onboarding state machine itself (already built in Phase 6)


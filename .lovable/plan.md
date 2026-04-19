

User wants: when a new user joins via Telegram, the bot starts a personalized onboarding conversation (bet type preference, sports, bankroll), then uses those answers to filter which generator outputs and stake sizes get sent to that specific customer.

Current state I need to verify:
- Telegram webhook exists (`telegram-webhook` from Phase 2) — handles incoming messages
- `bot_authorized_users` table exists with chat_id, username, bankroll
- Customer fanout in dispatcher already supports per-customer personalization (saw `personalize` callback in bot-send-telegram)
- No preference table currently — need one
- No conversation state machine for multi-step onboarding — need one
- Currently `/start <password>` activates user but skips straight to picks

Let me check what onboarding flow exists today and what fanout filtering looks like.
- `bot_authorized_users` already tracks active subs but has no preference fields
- Telegram webhook already routes commands but no onboarding wizard
- Fanout currently sends ALL alerts to ALL active users — no filtering

# Personalized Onboarding + Customer-Specific Pick Routing

## What I'll build

### 1. New table: `bot_user_preferences`
One row per Telegram user, captured during onboarding:
- `chat_id` (FK to `bot_authorized_users.chat_id`, PK)
- `bet_type` enum: `'parlays_only'` | `'singles_only'` | `'both'`
- `sports` text[] — `['NBA', 'MLB', 'NFL', 'NHL', 'tennis', 'soccer']`
- `bankroll_size` numeric — their personal bankroll (used for stake math)
- `risk_profile` enum: `'conservative'` | `'balanced'` | `'aggressive'` (derived + override)
- `min_confidence` numeric — auto-set from risk profile (75 / 65 / 55)
- `max_legs` int — parlay leg cap based on profile (2 / 3 / 5)
- `preferred_alert_types` text[] — generator names they opted in to (auto-populated from sport + bet_type, editable)
- `onboarding_step` text — state machine cursor: `'awaiting_bet_type'` | `'awaiting_sports'` | `'awaiting_bankroll'` | `'awaiting_risk'` | `'complete'`
- `onboarding_completed_at` timestamp
- `last_modified_at`

### 2. New shared lib: `_shared/onboarding-state-machine.ts`
Pure state machine for the 4-step conversation:

```
START → awaiting_bet_type → awaiting_sports → awaiting_bankroll → awaiting_risk → complete
```

Each step:
- Sends a question with inline keyboard buttons (no free text where avoidable)
- Validates answer
- Persists to `bot_user_preferences`
- Advances cursor + sends next question
- After `complete`: sends a personalized welcome summary + first-day expectations

The bot's voice during onboarding uses `voice.ts` humor lines, e.g.:
> "Welcome aboard 👋 Before I send you a single pick, I need to know how you bet. No point flooding you with parlays if you're a singles person."
> 
> [🎯 Singles only] [🎰 Parlays only] [🔥 Both]

### 3. New shared lib: `_shared/customer-pick-router.ts`
The filter that decides which alerts each customer sees. Called inside `fanoutToCustomers` (already exists in `telegram-client.ts`).

For each `(customer, alert)` pair:
- **Sport filter**: if alert.sport not in `customer.sports` → skip
- **Bet type filter**: if alert is parlay and `bet_type='singles_only'` → skip
- **Confidence filter**: if pick confidence < `customer.min_confidence` → skip
- **Generator filter**: if alert source not in `preferred_alert_types` → skip
- **Personalized stake**: replace bot's stake recommendation with customer's % of THEIR bankroll
  - Execution tier → 5% of their bankroll
  - Validation tier → 2.5%
  - Exploration tier → 1%
- **Risk gate**: aggressive customers see exploration picks; conservative only see execution tier

Returns `{ shouldSend: boolean, personalizedMessage?: string, skipReason?: string }`.

### 4. Update `telegram-webhook/index.ts`
Add three new flow branches:
- **`/start <password>`** (existing, modified): create authorized user → set `onboarding_step='awaiting_bet_type'` → fire onboarding step 1
- **Callback queries during onboarding**: route to `onboarding-state-machine.handleCallback()` — state machine advances itself
- **`/preferences`** (new): re-show current settings with edit buttons, lets user change anything later
- **Free-text bankroll input**: if `onboarding_step='awaiting_bankroll'` and message is a number → save as bankroll

### 5. Update `_shared/telegram-client.ts → fanoutToCustomers`
Currently sends the same message to every active customer. Change to:
- Pull `bot_user_preferences` joined with `bot_authorized_users`
- For each customer, call `customerPickRouter.shouldDeliver(customer, alertContext)`
- If yes, render personalized message (with their stake based on their bankroll)
- If no, log skip reason to `bot_message_log` (so we can audit "why didn't customer X get alert Y?")

This requires the dispatcher to receive richer alert context — add optional `alert_context` field to dispatcher payload:
```ts
alert_context?: {
  sport?: string;
  generator?: string;
  confidence?: number;
  is_parlay?: boolean;
  pick_id?: string;
}
```
Backwards-compatible: when missing, fall back to current "send to everyone" behavior.

### 6. Update existing generators (lightweight)
The 4 v2 generators already write rich `Pick` objects. When they call dispatcher, they now also pass `alert_context`. Legacy generators going through compat shim get a best-effort context inferred from `body.type`.

### 7. New onboarding welcome message
After step 4 completes, send a personalized recap:
> "Locked in. Here's your profile:
> 🎯 Bet type: Both singles and parlays
> 🏀⚾ Sports: NBA, MLB
> 💰 Bankroll: $2,000 (you'll see stake amounts based on this)
> ⚖️ Risk: Balanced — I'll send picks I'm 65%+ confident on
> 
> First picks roll in around 2 PM ET. Reply /preferences anytime to adjust. Let's eat. 🍽️"

## Files touched

**Create:**
- `supabase/functions/_shared/onboarding-state-machine.ts`
- `supabase/functions/_shared/customer-pick-router.ts`

**Modify:**
- `supabase/functions/telegram-webhook/index.ts` (route onboarding callbacks + `/preferences` command)
- `supabase/functions/_shared/telegram-client.ts` (fanout filters by preference + personalizes stake)
- `supabase/functions/bot-send-telegram/index.ts` (accept `alert_context`, pass to fanout)
- The 4 v2 generators (add `alert_context` to their dispatch calls)

**DB migration:**
- Create `bot_user_preferences` table with RLS (service-role only writes; users can read their own row)
- Default seed for any existing active users: `onboarding_step='legacy_skip'`, conservative defaults so they keep getting current alerts until they re-onboard

## Onboarding conversation example

```
Bot: Welcome to ParlayIQ 👋 Quick 4 questions so I send you 
     picks you'll actually use, not 50 alerts a day you'll mute.
     
     How do you bet?
     [🎯 Singles] [🎰 Parlays] [🔥 Both]

User: *taps "Both"*

Bot: 👍 Which sports?
     [🏀 NBA] [⚾ MLB] [🏈 NFL] [🏒 NHL] [🎾 Tennis] [✅ Done]
     (tap as many as you want)

User: *taps NBA, MLB, then Done*

Bot: 💰 What's your betting bankroll? Just type a number.
     (this is just for stake sizing — I'll never see your real account)

User: 2000

Bot: ⚖️ Last one — risk profile?
     [🛡️ Conservative — only my best plays] 
     [⚖️ Balanced — mix of safe + value]
     [🚀 Aggressive — show me everything]

User: *taps "Balanced"*

Bot: Locked in. [recap message above] Let's eat. 🍽️
```

## Risk + rollback
- **Risk**: existing users without preferences get filtered into oblivion. Mitigation: default seed marks them `legacy_skip` → router treats them as opt-in to everything (current behavior) until they run `/preferences`.
- **Risk**: state machine gets stuck if user ignores a question. Mitigation: any free-text message during onboarding re-sends the current step's prompt; `/start` resets state.
- **Rollback**: env flag `DISABLE_PERSONALIZATION=true` makes router pass-through everyone (Phase 5 behavior).

## Testing (project policy: 5 verifications)
1. New `/start <password>` → verify all 4 onboarding steps fire in order
2. Complete onboarding → verify `bot_user_preferences` row written correctly
3. Customer with `sports=['NBA']` → verify MLB alerts get filtered out
4. Customer with `bankroll=2000`, Execution tier alert → verify stake renders as $100 (5%)
5. `/preferences` command → verify current settings displayed with edit buttons
6. `DISABLE_PERSONALIZATION=true` → verify rollback works (everyone gets everything)

## What does NOT change
- Existing 99 generators stay untouched
- Dispatcher contract is backwards-compatible (alert_context is optional)
- Phase 4 bankroll-curator and Phase 5 enrichment still run for the BOT's bankroll/voice — customer personalization is a layer on top
- Frontend, blog, settlement, hedge — zero touch


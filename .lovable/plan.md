
# Telegram Bot Notifications + Real Prop Line Verification

## Overview

Implement two key enhancements:
1. **Telegram Bot Integration** - Free, instant notifications directly to your phone
2. **Real Prop Line Verification** - Ensure the bot always pulls live lines from The Odds API, not placeholders

## Current State Analysis

### What I Found

| Component | Status |
|-----------|--------|
| `unified_props` table | ✅ Has REAL live lines from FanDuel/DraftKings with `current_line`, `over_price`, `under_price` |
| `category_sweet_spots` | Has `recommended_line` AND `actual_line` - bot should use `actual_line` |
| `fetch-current-odds` | ✅ Connects to The Odds API with priority bookmakers (FanDuel, DraftKings) |
| `THE_ODDS_API_KEY` | ✅ Already configured in secrets |
| SMS via Twilio | ✅ Configured but costs money per message |
| Telegram integration | ❌ Not implemented yet |

### Data Verification - Real Lines Are Available
Sample data from `unified_props`:
```text
Donovan Mitchell - Points 30.5 @ -122/-108 (FanDuel)
Jarrett Allen - Points 28.5 @ -140/+110 (DraftKings)
```

## Implementation Plan

### Phase 1: Telegram Bot Setup

#### 1.1 Create Telegram Bot via @BotFather

**User Steps** (I'll guide you through this):
1. Open Telegram, search for `@BotFather`
2. Send `/newbot`
3. Name it: "ParlayIQ Bot" 
4. Username: Choose unique (e.g., `parlayiq_alerts_bot`)
5. Copy the **API Token** provided
6. Send `/setdescription` → "Get real-time updates from your autonomous betting bot"

#### 1.2 New Edge Function: `bot-send-telegram`

```typescript
// supabase/functions/bot-send-telegram/index.ts

/**
 * Send Telegram messages for bot events:
 * - Parlay generation complete
 * - Daily settlement results  
 * - Activation status changes
 * - Category weight updates
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

interface TelegramMessage {
  type: 'parlays_generated' | 'settlement_complete' | 'activation_ready' | 'daily_summary';
  data: Record<string, any>;
}

Deno.serve(async (req) => {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID'); // Your personal chat ID
  
  const { type, data } = await req.json();
  
  // Format message based on type
  let message = formatMessage(type, data);
  
  // Send via Telegram API
  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    }),
  });
});
```

#### 1.3 Message Templates

```text
📊 PARLAY GENERATION COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━

Generated: 9 parlays for Feb 8
Distribution:
• 3-Leg (Conservative): 2 parlays
• 4-Leg (Balanced): 2 parlays  
• 5-Leg (Standard): 3 parlays
• 6-Leg (Aggressive): 2 parlays

🎯 Top Pick: LeBron James
Points OVER 25.5 @ +120
Value Score: 78/100

📈 Odds Range: +280 to +4,850
📍 Using REAL lines from FanDuel/DraftKings

View: parlaysimulator.lovable.app/bot
```

```text
💰 DAILY SETTLEMENT REPORT
━━━━━━━━━━━━━━━━━━━━━━

Yesterday: Feb 7
Result: 6/9 parlays hit (67%)

P/L: +$180 (simulation)
Bankroll: $1,360 → $1,540

🔥 Streak: 2 consecutive profitable days
⚡ 1 MORE DAY until Real Mode!

Weight Changes:
↑ HIGH_ASSIST_UNDER: 1.02 → 1.08
↓ BIG_REBOUND_OVER: 0.95 → 0.91
```

```text
🚀 BOT ACTIVATED FOR REAL MODE
━━━━━━━━━━━━━━━━━━━━━━━━━━

Status: REAL MODE UNLOCKED!

Achievement:
✅ 3 consecutive profitable days
✅ 60%+ win rate (67%)
✅ Bankroll growth: $1,000 → $1,540

Next: Bot will generate parlays with Kelly-sized stakes

Configure your bankroll in settings.
```

### Phase 2: Real Prop Line Verification

#### 2.1 Issue Identified

In `bot-generate-daily-parlays`, line 382-395:
```typescript
// Current: Fetches from unified_props
const { data: oddsData } = await supabase
  .from('unified_props')
  .select('player_name, prop_type, over_price, under_price')
  .in('player_name', playerNames)
  .eq('is_active', true);
```

**This is correct!** The `unified_props` table already contains real lines from FanDuel and DraftKings.

However, I noticed `category_sweet_spots` has both:
- `recommended_line` - Placeholder/suggested line
- `actual_line` - REAL sportsbook line

#### 2.2 Ensure Bot Uses Real Lines

Update `bot-generate-daily-parlays` to:
1. **Verify** `actual_line` exists before using `recommended_line`
2. **Add validation logging** to confirm real lines are being used
3. **Fall back** to fetching live odds if `actual_line` is null

```typescript
// Enhanced pick loading with line verification
const picks = await supabase
  .from('category_sweet_spots')
  .select('*, actual_line, recommended_line')
  .eq('analysis_date', targetDate)
  .eq('is_active', true);

// Use actual_line when available, recommended_line as fallback
const enrichedPicks = picks.map(pick => {
  const line = pick.actual_line ?? pick.recommended_line;
  const hasRealLine = pick.actual_line !== null;
  
  console.log(`[Bot] ${pick.player_name}: ${hasRealLine ? 'REAL' : 'PLACEHOLDER'} line ${line}`);
  
  return { ...pick, line, has_real_line: hasRealLine };
});

// Filter to only picks with real lines in test mode
const realLinePicks = enrichedPicks.filter(p => p.has_real_line);
console.log(`[Bot] ${realLinePicks.length}/${enrichedPicks.length} picks have REAL lines`);
```

#### 2.3 Add Line Source Tracking

Store where each line came from:

```typescript
legs.push({
  // ... existing fields
  line_source: hasRealLine ? 'fanduel' : 'projected',
  line_verified_at: new Date().toISOString(),
});
```

### Phase 3: Dashboard Updates

#### 3.1 New Component: `BotNotificationSettings.tsx`

```text
┌─────────────────────────────────────────┐
│ 📱 Telegram Notifications               │
├─────────────────────────────────────────┤
│ Status: ✅ Connected                    │
│                                         │
│ ✅ Parlay Generation (9 AM ET)          │
│ ✅ Settlement Reports (6 AM ET)         │
│ ✅ Activation Alerts                    │
│ ☐ Category Weight Changes               │
│ ☐ Strategy Retirements                  │
│                                         │
│ [Test Notification]  [Disconnect]       │
└─────────────────────────────────────────┘
```

#### 3.2 New Component: `BotActivityFeed.tsx`

Real-time log of bot actions:

```text
┌─────────────────────────────────────────┐
│ 🔔 Activity Feed          [Auto-refresh]│
├─────────────────────────────────────────┤
│ 9:02 AM  ✅ Generated 9 parlays         │
│          📊 Using 47 REAL prop lines    │
│ 9:01 AM  🔍 Loaded category weights     │
│ 9:00 AM  🤖 Daily generation started    │
│ 6:05 AM  💰 Day 2 profitable (+$85)     │
│ 6:02 AM  📈 Weight boost: HIGH_ASSIST   │
│ 6:01 AM  ✅ Settled 8 parlays (5 wins)  │
└─────────────────────────────────────────┘
```

#### 3.3 Line Verification Indicator

On each parlay card, show line source:

```text
LeBron James
Points OVER 25.5 @ +120
📍 FanDuel (verified 9:01 AM)
```

### Phase 4: Database Changes

#### 4.1 New Table: `bot_notification_settings`

```sql
CREATE TABLE bot_notification_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  
  -- Telegram config
  telegram_chat_id text,
  telegram_enabled boolean DEFAULT true,
  
  -- Notification toggles
  notify_parlays_generated boolean DEFAULT true,
  notify_settlement boolean DEFAULT true,
  notify_activation_ready boolean DEFAULT true,
  notify_weight_changes boolean DEFAULT false,
  notify_strategy_updates boolean DEFAULT false,
  
  -- Quiet hours (ET timezone)
  quiet_start_hour int DEFAULT 23,
  quiet_end_hour int DEFAULT 7,
  
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

#### 4.2 New Table: `bot_activity_log`

```sql
CREATE TABLE bot_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  event_type text NOT NULL,
  message text NOT NULL,
  metadata jsonb,
  severity text DEFAULT 'info'
);

CREATE INDEX idx_bot_activity_created ON bot_activity_log(created_at DESC);
```

### Phase 5: Integration Points

#### 5.1 Update `bot-generate-daily-parlays`

Add at end of successful generation:
```typescript
// Log activity
await supabase.from('bot_activity_log').insert({
  event_type: 'parlays_generated',
  message: `Generated ${parlaysToCreate.length} parlays for ${targetDate}`,
  metadata: { 
    legCounts, 
    realLinePicks: realLinePicks.length,
    totalPicks: validPicks.length 
  }
});

// Send Telegram notification
await supabase.functions.invoke('bot-send-telegram', {
  body: {
    type: 'parlays_generated',
    data: {
      count: parlaysToCreate.length,
      distribution: legCounts,
      topPick: parlaysToCreate[0]?.legs[0],
      realLinePercentage: (realLinePicks.length / validPicks.length * 100).toFixed(0),
    }
  }
});
```

#### 5.2 Update `bot-settle-and-learn`

Add at end of settlement:
```typescript
// Log activity
await supabase.from('bot_activity_log').insert({
  event_type: 'settlement_complete',
  message: `Settled ${parlaysSettled} parlays: ${parlaysWon}W ${parlaysLost}L`,
  metadata: { totalProfitLoss, consecutiveDays: newConsecutive }
});

// Send Telegram notification
await supabase.functions.invoke('bot-send-telegram', {
  body: {
    type: 'settlement_complete',
    data: {
      parlaysWon,
      parlaysLost,
      profitLoss: totalProfitLoss,
      consecutiveDays: newConsecutive,
      bankroll: newBankroll,
    }
  }
});
```

## File Changes Summary

| File | Change |
|------|--------|
| `supabase/functions/bot-send-telegram/index.ts` | **NEW** - Telegram notification sender |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Add line verification + Telegram trigger |
| `supabase/functions/bot-settle-and-learn/index.ts` | Add Telegram trigger after settlement |
| `src/components/bot/BotNotificationSettings.tsx` | **NEW** - Telegram settings UI |
| `src/components/bot/BotActivityFeed.tsx` | **NEW** - Real-time activity log |
| `src/pages/BotDashboard.tsx` | Add notification settings + activity feed sections |
| `src/components/bot/BotParlayCard.tsx` | Add line source indicator |
| `supabase/config.toml` | Register new edge function |

## Secrets Required

A new secret will be requested:
- **TELEGRAM_BOT_TOKEN** - From @BotFather when you create the bot
- **TELEGRAM_CHAT_ID** - Your personal chat ID (obtained via @userinfobot)

## Setup Steps

1. **Create Telegram Bot**:
   - Message @BotFather on Telegram
   - `/newbot` → Name: "ParlayIQ Bot"
   - Copy the API token

2. **Get Your Chat ID**:
   - Message @userinfobot on Telegram
   - Copy your numeric chat ID

3. **Start Your Bot**:
   - Search for your new bot in Telegram
   - Press "Start" to enable messages

4. **Configure in Lovable**:
   - I'll request the secrets from you
   - Notifications will start flowing automatically

## Expected Notifications

When the bot runs at 9 AM ET:
```text
📊 PARLAY GENERATION COMPLETE

Generated: 9 parlays for Feb 8

📍 100% REAL lines verified (47/47)
📈 Odds Range: +280 to +4,850

Top Pick: Donovan Mitchell
Points OVER 30.5 @ -115 (DraftKings)

View: parlaysimulator.lovable.app/bot
```

When settlement runs at 6 AM ET:
```text
💰 SETTLEMENT: 6/9 hit (67%)
P/L: +$180 | Bankroll: $1,540
🔥 2/3 days to Real Mode!
```

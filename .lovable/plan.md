
# Two-Way Telegram Bot Communication

## Overview
Add the ability to chat with ParlayIQ Bot via Telegram - send commands, ask for updates, and give recommendations. The bot will use AI to understand natural language requests and respond with relevant data.

---

## How It Will Work

```text
 User sends "start" or "show today's picks"
              │
              ▼
    ┌─────────────────────┐
    │  Telegram Servers   │
    └──────────┬──────────┘
               │ webhook POST
               ▼
    ┌─────────────────────────┐
    │ telegram-webhook (new)  │
    │  - Parse user message   │
    │  - Route to handler     │
    │  - Call AI if needed    │
    │  - Fetch bot data       │
    └──────────┬──────────────┘
               │
               ▼
    ┌─────────────────────────┐
    │    Send reply via       │
    │    Telegram API         │
    └─────────────────────────┘
```

---

## User Commands Supported

| Command | Description |
|---------|-------------|
| `/start` | Welcome message with available commands |
| `/status` | Current bot mode, bankroll, streak |
| `/parlays` | Today's generated parlays summary |
| `/performance` | Win rate, ROI, recent results |
| `/weights` | Top category weights |
| `/generate` | Trigger parlay generation |
| `/settle` | Trigger settlement |
| Natural language | AI-powered responses to questions like "how did we do yesterday?" or "what's your best pick?" |

---

## Implementation Plan

### Step 1: Create New Edge Function - `telegram-webhook`

A new edge function to receive incoming Telegram messages:

**File:** `supabase/functions/telegram-webhook/index.ts`

```typescript
import { Bot, webhookCallback } from "https://deno.land/x/grammy@v1.39.3/mod.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const bot = new Bot(Deno.env.get("TELEGRAM_BOT_TOKEN")!);

// Command handlers
bot.command("start", async (ctx) => {
  await ctx.reply(`🤖 *ParlayIQ Bot*\n\nCommands:\n/status - Bot status\n/parlays - Today's picks\n/performance - Stats\n/weights - Category weights\n/generate - Generate parlays\n/settle - Settle & learn\n\nOr just ask me anything!`, { parse_mode: "Markdown" });
});

bot.command("status", async (ctx) => { /* fetch activation status */ });
bot.command("parlays", async (ctx) => { /* fetch today's parlays */ });
bot.command("performance", async (ctx) => { /* fetch win rate, ROI */ });
bot.command("weights", async (ctx) => { /* fetch top weights */ });
bot.command("generate", async (ctx) => { /* trigger generation */ });
bot.command("settle", async (ctx) => { /* trigger settlement */ });

// Natural language via AI
bot.on("message:text", async (ctx) => {
  // Use Lovable AI to understand intent and generate response
});

const handleUpdate = webhookCallback(bot, "std/http");
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  if (secret !== Deno.env.get("FUNCTION_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }
  return await handleUpdate(req);
});
```

### Step 2: Add Webhook Secret

Add a new secret for webhook authentication:
- `TELEGRAM_WEBHOOK_SECRET` - Random string to verify webhook calls

### Step 3: Configure Telegram Webhook URL

After deployment, set the webhook with Telegram:
```
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://pajakaqphlxoqjtrxzmi.supabase.co/functions/v1/telegram-webhook?secret=<SECRET>
```

### Step 4: Update config.toml

Add the new function configuration:
```toml
[functions.telegram-webhook]
verify_jwt = false
```

### Step 5: Create Conversation History Table (Optional Enhancement)

Store conversation context for better AI responses:

```sql
CREATE TABLE bot_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_chat_id TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user' or 'assistant'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_bot_conversations_chat ON bot_conversations(telegram_chat_id, created_at DESC);
```

### Step 6: AI Integration for Natural Language

Use Lovable AI (google/gemini-3-flash-preview) to understand user intent:

```typescript
async function handleNaturalLanguage(message: string, chatId: string) {
  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { 
          role: "system", 
          content: `You are ParlayIQ Bot, an autonomous betting bot assistant. 
          You help users check parlay status, performance, and give recommendations.
          Available data sources: today's parlays, win rate, bankroll, category weights.
          Keep responses concise for Telegram (under 300 chars when possible).
          Use Markdown formatting.` 
        },
        { role: "user", content: message }
      ],
      tools: [
        { type: "function", function: { name: "get_status", ... }},
        { type: "function", function: { name: "get_parlays", ... }},
        { type: "function", function: { name: "get_performance", ... }},
      ],
      tool_choice: "auto"
    }),
  });
  // Process response and tool calls
}
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/telegram-webhook/index.ts` | **Create** | New webhook handler for incoming messages |
| `supabase/config.toml` | **Modify** | Add `telegram-webhook` function config |
| Database migration | **Create** | Add `bot_conversations` table |

---

## Security Considerations

1. **Webhook secret** - Verify all incoming requests with a secret parameter
2. **Rate limiting** - Limit commands per user to prevent abuse
3. **Chat ID validation** - Optionally restrict to configured `TELEGRAM_CHAT_ID`

---

## Example Conversation

**User:** "how are we doing today?"

**Bot:**
```
📊 Today's Status

Mode: Simulation
Streak: 2 profitable days
Bankroll: $1,247

Today's Parlays: 8 generated
• 2 Conservative (3-leg)
• 3 Balanced (4-leg)
• 3 Aggressive (6-leg)

82% real lines verified ✓
```

**User:** "generate new parlays"

**Bot:**
```
🎯 Generating parlays...

✅ Created 9 parlays for today
Distribution:
• 3-Leg: 2 parlays
• 4-Leg: 2 parlays
• 5-Leg: 3 parlays
• 6-Leg: 2 parlays

View details: /parlays
```

---

## Technical Notes

1. **grammY Framework** - Uses the popular Telegram bot framework for Deno, handling message parsing and reply formatting
2. **Lovable AI** - Powers natural language understanding without requiring additional API keys
3. **Supabase Integration** - Fetches live data from existing tables (bot_daily_parlays, bot_activation_status, bot_category_weights)
4. **Activity Logging** - All user interactions logged to `bot_activity_log` for the dashboard feed


# Add AI Help / Q&A for Clients in Telegram Bot

## Problem

Non-admin clients can use 7 commands but have zero ability to ask questions. When they type anything outside those commands, they get:

> "🔒 This command is only available to admins. Use /help to see available commands!"

The `handleNaturalLanguage()` function — which is powered by Gemini and already has full bot context (parlays, performance, bankroll, live picks) — is **gated to admin-only**. Clients cannot access it at all.

## What Needs to Change

**File:** `supabase/functions/telegram-webhook/index.ts`

### Change 1 — Upgrade `/help` for clients (line 1800–1810)

Replace the bare static list with a richer message that:
- Explains all 7 commands clearly
- Explicitly tells clients they can ask questions in plain English
- Gives example questions they can ask

Current `/help` response:
```
📋 *Available Commands*

/parlays — Today's picks
/parlay — Pending summary
/performance — Win rate & ROI
/calendar — Monthly P&L
/roi — Detailed ROI breakdown
/streaks — Hot & cold streaks
/help — This list
```

New `/help` response (customer-aware):
```
📋 *Parlay Farm — Help*

*Commands:*
/parlays — Today's full pick list
/parlay — Pending bets summary
/performance — Win rate & ROI stats
/calendar — This month's P&L
/roi — Detailed ROI by time period
/streaks — Hot & cold streaks

💬 *Ask me anything:*
Just type a question in plain English! Examples:
• "How are we doing this week?"
• "Which picks look the strongest today?"
• "What's my ROI this month?"
• "Explain how the bot picks work"
• "Is today a good day to bet?"
```

Admins keep their existing long command list (no change there).

### Change 2 — Enable AI Q&A for all non-admin users (line 1812–1815)

Currently:
```typescript
// All other commands: admin only
if (!isAdmin(chatId)) {
  return "🔒 This command is only available to admins.\n\nUse /help to see available commands!";
}
```

Replace the generic "admin only" block with a **customer AI handler** that routes unrecognised input to `handleNaturalLanguage()` for non-admin users, with a **client-safe system prompt** that:
- Does NOT expose admin/internal data (no bankroll admin controls, no category weights detail, no bot internal state)
- Answers questions about today's picks, win rates, performance, and general betting guidance
- Keeps responses concise and encouraging
- Falls back gracefully if the AI is unavailable

New logic:
```typescript
// All other commands: admin only, but non-admins get AI Q&A
if (!isAdmin(chatId)) {
  // If it looks like a slash command, block it
  if (cmd.startsWith('/')) {
    return "🔒 This command is for admins only.\n\nUse /help to see your available commands, or just ask me a question!";
  }
  // Otherwise route to customer-safe AI Q&A
  await saveConversation(chatId, "user", text);
  const response = await handleCustomerQuestion(text, chatId);
  await saveConversation(chatId, "assistant", response);
  return response;
}
```

### Change 3 — New `handleCustomerQuestion()` function

Add a new function (before `handleMessage`) that wraps `handleNaturalLanguage` with a **client-specific system prompt**:

```typescript
async function handleCustomerQuestion(message: string, chatId: string): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return "I'm not able to answer questions right now. Use /parlays, /performance, or /help to check the bot.";
  }

  const history = await getConversationHistory(chatId, 6);
  const [parlays, performance] = await Promise.all([getParlays(), getPerformance()]);

  const systemPrompt = `You are ParlayIQ Bot, a friendly sports betting assistant for Parlay Farm members.
You help members understand today's picks and track their performance.

CURRENT DATA:
- Today's Parlays: ${parlays.count} generated
- Distribution: ${Object.entries(parlays.distribution).map(([l, c]) => `${l}-leg: ${c}`).join(', ') || 'None'}
- Performance: ${performance.winRate.toFixed(1)}% win rate, ${performance.roi.toFixed(1)}% ROI
- Record: ${performance.wins}W - ${performance.losses}L

RULES:
- Be friendly, concise, and helpful (under 400 chars when possible)
- Never share admin controls, internal weights, or system configuration
- If asked about specific picks, direct them to /parlays
- If asked about ROI or stats, give the real numbers above
- Use Telegram Markdown (*bold*, _italic_) and emojis
- If you can't answer something, say "Try /help to see what I can show you"`;

  const messages = [
    { role: "system" as const, content: systemPrompt },
    ...history.map(h => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user" as const, content: message },
  ];

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages, max_tokens: 400 }),
    });
    if (!response.ok) return "I'm having trouble right now. Try /parlays or /performance.";
    const data = await response.json();
    return data.choices?.[0]?.message?.content || "Use /help to see available commands.";
  } catch {
    return "Something went wrong. Use /parlays or /help for quick info.";
  }
}
```

### Change 4 — Update `handleCustomerStart()` to mention Q&A (line 1763–1780)

Add one line to the welcome message so new clients know they can ask questions immediately:

```
💬 Or just *ask me anything* in plain English!
```

## Technical Notes

- Conversation history is saved/loaded per `chatId` from `bot_conversations` — this already works for admin, and will now work for clients too (same table, same functions)
- The `LOVABLE_API_KEY` is already configured — no new secrets needed
- The client prompt deliberately hides `bot_adaptation_state`, `bot_category_weights`, and bankroll controls from clients
- Admin natural language fallback (line 1839) is **unchanged** — admins still get the full system prompt with all internal data
- The `if (cmd.startsWith('/'))` guard ensures unknown slash commands still get the "admin only" message rather than being sent to the AI

## Files to Change

1. `supabase/functions/telegram-webhook/index.ts` — 4 targeted edits:
   - Add `handleCustomerQuestion()` function (~40 lines, before `handleMessage`)
   - Update `/help` handler (lines 1800–1810) — customer-aware response
   - Replace the admin-only wall (lines 1812–1815) — route non-command text to AI
   - Add one line to `handleCustomerStart()` (line 1778) — mention Q&A

No database migrations needed. No new secrets needed.

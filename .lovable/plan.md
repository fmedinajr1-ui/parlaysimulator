

# Add `/research` Command to Telegram Bot

## What It Does
Adds a `/research` command that triggers the AI Research Agent on demand from Telegram, so you can get fresh intelligence anytime -- not just from the daily cron.

## How It Works

1. You type `/research` in Telegram
2. Bot replies "Running research agent..." immediately
3. Bot invokes the `ai-research-agent` edge function
4. When complete, bot sends the results summary back to you in chat

## Changes

### File: `supabase/functions/telegram-webhook/index.ts`

**Add a `handleResearch` function** that:
- Sends an immediate "running..." acknowledgment message
- Calls `supabase.functions.invoke('ai-research-agent')` 
- Parses the response (findings count, actionable count, category summaries)
- Formats a Telegram-friendly digest with category insights and relevance scores
- Returns the formatted results

**Add the command route** in the `handleMessage` function:
- Add `else if (command === "/research")` before the natural language fallback

**Update the `/start` help text** to include `/research` in the command list under a new "Intelligence" section.

## Expected Output in Telegram

```text
Running AI research agent...

Research Complete
- Competing AI Systems: 4 insights (high relevance)
- Statistical Models: 8 insights (high relevance)  
- Injury/Lineup Intel: 10 insights (high relevance)

3/3 categories with actionable intel
Full digest also sent to notification channel.
```


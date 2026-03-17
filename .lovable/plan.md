

# Fix Slate Advisory Telegram Format

## Problems
1. **HTML not rendering** — The `bot-send-telegram` raw message passthrough (line 1672) never passes `parse_mode` to the Telegram API, so `<b>` tags show as literal text in the screenshot.
2. **Robotic language** — Fields like "Stake Multiplier: 0.5x" and "Max Legs: 3" are internal jargon, not customer-friendly language.

## Changes

### 1. Fix `bot-send-telegram` to support `parse_mode`
**File**: `supabase/functions/bot-send-telegram/index.ts`
- In the raw message passthrough block (~line 1668-1708), read `reqBody.parse_mode` and include it in every `sendMessage` call body (both the initial send and chunked fallback sends).
- This is a one-line addition in 3 places within `sendRaw`: add `if (parseMode) body.parse_mode = parseMode;`

### 2. Redesign the admin Telegram message
**File**: `supabase/functions/send-slate-advisory/index.ts`
- Replace the current layout with a cleaner, icon-driven format using natural language:

```
🔴 SLATE ADVISORY — Mar 17, 2026

📊 Thin Slate Day
Only 4 games on the board today (NBA, NHL)

⚠️ What This Means
→ Cut your stakes in half
→ Keep parlays to 3 legs max
→ Be extra selective with picks

🔍 Flags to Watch
🔁 0 revenge matchups
😴 1 team on a back-to-back
💥 0 blowout risks
```

- Use Markdown (`*bold*`) instead of HTML since other raw messages use Markdown
- Friendly, conversational tone instead of data-dump style

### 3. Improve the customer notification message
**File**: `supabase/functions/send-slate-advisory/index.ts`
- Make the customer push/in-app message more actionable and less robotic:
  - Thin: "🔴 Light day — only 4 games. Go easy on stakes and keep parlays short."
  - Light: "🟡 Moderate slate — 7 games today. Dial back stakes a bit."
  - Heavy: "🟢 Loaded slate — 12 games across NBA/NHL. Full send today!"

### Files to Change
| File | Change |
|------|--------|
| `supabase/functions/bot-send-telegram/index.ts` | Pass `parse_mode` from request body into Telegram API calls |
| `supabase/functions/send-slate-advisory/index.ts` | Redesign admin + customer messages with icons and natural language |


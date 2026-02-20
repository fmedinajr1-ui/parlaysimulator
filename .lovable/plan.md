
## Self-Fetch Daily Winners in bot-send-telegram

### What changes
When `bot-send-telegram` receives a `daily_winners` notification with no `data` payload (or empty data), it will automatically call the `bot-daily-winners` edge function to fetch the data itself before formatting and sending the message.

### Why
Currently, manual triggers of `daily_winners` require the caller to pass the full data object. This change makes it so you can simply call `bot-send-telegram` with `{ "type": "daily_winners" }` and it handles everything.

### Technical Details

**File:** `supabase/functions/bot-send-telegram/index.ts`

**Change location:** After parsing `{ type, data }` from the request body (~line 564), add a block that checks if `type === 'daily_winners'` and `data` is missing/empty. If so, fetch it:

```typescript
const { type, data: rawData }: NotificationData = await req.json();

let data = rawData;

// Self-fetch daily winners data if not provided
if (type === 'daily_winners' && (!data || Object.keys(data).length === 0)) {
  console.log('[Telegram] No data provided for daily_winners, self-fetching...');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const resp = await fetch(`${supabaseUrl}/functions/v1/bot-daily-winners`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  data = await resp.json();
  console.log(`[Telegram] Fetched daily winners: ${data?.totalHits}/${data?.totalPicks}`);
}
```

This is a ~15-line addition. No other files need changes.

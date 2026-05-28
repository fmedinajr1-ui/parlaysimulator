## What I found

The previous fix added `message` to the top-level body sent to `bot-send-telegram`, but evidence shows the message still isn't reaching Telegram:

- Edge logs for `bot-send-telegram` show **only 2 invocations**, both at 12:12:36–37Z (the first force trigger, **before** my patch) and both returned **HTTP 400**.
- After the patch, the trigger at 12:13:14Z completed the candidate scan and logged `[Ladder] Top 5`, but there is **no `[Ladder] telegram non-ok`** warning and **no new `bot-send-telegram` invocation row in analytics**.
- That mismatch means either (a) the redeploy of `nba-ladder-challenge` didn't take effect for that test run, or (b) `bot-send-telegram` is still rejecting and we're swallowing it.

So the root cause is not yet confirmed. I want to fix the diagnostics, redeploy, and try again with eyes on the actual response.

## Plan

### 1. Harden `sendTelegram` in `nba-ladder-challenge`
- Always `console.log` the HTTP status + parsed JSON response body (success or fail) so the next force-trigger leaves a paper trail in edge logs.
- Strip Markdown special chars (`_`, `*`, `` ` ``, `[`) from dynamic player/team/prop strings before composing the panel and the lock card. Telegram's Markdown parser returns 400 on unbalanced `_` (we have players like "Luguentz Dort" but also names containing `_`/`.` that can break parsing). Safer: switch the ladder panel + lock card to `parse_mode: 'HTML'` and escape `< > &`, since the panel mixes long lines and is the highest-risk for parse errors.
- Add a 4000-char safety trim per chunk before send (defensive — `bot-send-telegram` already chunks, but the panel can balloon with 10+ candidates).

### 2. Force redeploy `nba-ladder-challenge` and `bot-send-telegram`
Explicitly call `deploy_edge_functions` so we know the latest code is live, not relying on implicit deploy.

### 3. Re-trigger and verify
- `curl /nba-ladder-challenge?force=1`
- Pull `bot-send-telegram` logs and the analytics row to confirm HTTP 200 and `delivered/admin send` succeeded.
- Pull `nba-ladder-challenge` logs to confirm the new `[Ladder] telegram status=200` line.

### 4. If still 400 after step 3
- Inspect the actual error string returned (now logged in step 1). Most likely culprits in order:
  1. `parse_mode: 'Markdown'` parse failure on a candidate string → already mitigated by HTML switch.
  2. `TELEGRAM_CHAT_ID` env not set → bot-send-telegram returns 500, not 400, so unlikely.
  3. Service-role auth header rejected → would be 401, not 400.
- Add a fallback: if first send returns non-2xx, retry once with `parse_mode` omitted (plain text). Guarantees the admin always sees the panel even if formatting breaks.

### Technical details

Files touched:
- `supabase/functions/nba-ladder-challenge/index.ts` — `sendTelegram` helper (logging + HTML escape + plain-text retry), panel builder (switch to HTML tags `<b>`, `<code>`), lock-card builder (same).

No DB / schema / config.toml changes. No new secrets.

### Out of scope
- Changing who receives the panel (stays admin-only).
- Touching the actual ladder selection logic, MLB/NBA adapters, or sweet-spot scoring.

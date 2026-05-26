## Goal

Rotate the three secrets the GitHub Actions smoke workflow needs, and hand you the new values to paste into GitHub repo secrets.

## Honest tool constraints

Now that I've looked at what I can actually do, **full Option B isn't possible end-to-end from my side** — here's why, and what I *can* do:

| Secret | Can I rotate it? | How |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Yes, fully | `supabase--rotate_api_keys` generates a new key, updates Lovable Cloud + `.env` automatically. I can then read the new value and show it to you. |
| `ODDS_FEED_WEBHOOK_SECRET` | Partially | These are arbitrary HMAC strings, not managed keys. I can generate a fresh random value and **prompt you via a secure form** to paste it into Lovable Cloud (`secrets--update_secret`). You'd paste the same value into GitHub. |
| `LIVE_EVENT_WEBHOOK_SECRET` | Partially | Same as above. |

The Lovable secret tools (`add_secret`/`update_secret`) always require you to type the value into a secure form — I can't write secret values directly. So "I rotate it for you" really means "I generate a value, you paste it twice (once into the Lovable secure form, once into GitHub)".

## Proposed steps (build mode)

1. **Rotate Supabase service role key** via `supabase--rotate_api_keys`. Read the new value back and display it for you to paste into GitHub as `SUPABASE_SERVICE_ROLE_KEY`.
2. **Generate two fresh 48-byte random hex strings** for the webhook secrets. Show them to you in chat.
3. **Call `secrets--update_secret`** for `ODDS_FEED_WEBHOOK_SECRET` and `LIVE_EVENT_WEBHOOK_SECRET` — you paste the values from step 2 into the secure form (one paste each).
4. You then paste the same three values into GitHub → Settings → Secrets and variables → Actions.
5. Re-run the workflow from GitHub Actions → "Scout Speed Smoke" → "Run workflow" to confirm it goes green.

## Risk callout

Rotating the Supabase service role key **immediately invalidates the old one** everywhere it's used. Lovable Cloud edge functions auto-pick up the new value, but any *external* service holding the old service role key (custom scripts, external workers, the FanDuel worker if it uses it, etc.) will start failing until you update them.

Rotating the webhook secrets will break any external system currently signing requests to `/market-snapshot-ingest` or `/scout-live-edge` with the old secret, until they're updated.

If those risks are unacceptable, the safer move is **Option A** (I just fetch & show you the current values to paste into GitHub, no rotation). Say the word and I'll switch the plan to that.

## Out of scope

- Writing to your GitHub repo (no tool for that).
- Triggering the GitHub Actions run (you'll click "Run workflow").

## What you're asking for

1. **Bring parlay-generator accuracy back to 60%** — the leg-confidence floor used to be `0.60`, it's currently `0.65`. Drop it back so more legs qualify and the engine builds more parlays per slate.
2. **Make sure the parlays actually get delivered to Telegram.**

## What I found before planning

Good news on item 2 — **delivery is already working today**. I checked the database:

| Metric | Value |
|---|---|
| Parlays generated today (2026-04-26) | **4** |
| Broadcast to Telegram in the last 24h | **4** (chat `7705141526`, all 4 sent at 18:30 UTC) |
| Parlays last 7 days | 18 |
| `parlay_iq_autobroadcast_enabled` flag | **enabled = true** |

So the broadcaster IS firing — every parlay built today went to Telegram. The reason it *feels* dead is that **only 4 parlays survived the engine** (two `optimal_combo` EDGE + two `mega_lottery_scanner` LOTTERY). The bottleneck is the engine producing too few legs, not the Telegram pipe being broken. Lowering the confidence floor to 0.60 is exactly the right lever — more legs survive → more strategies fill their daily share → more parlays → more Telegram messages.

If you want me to *also* fix something about the Telegram messages themselves (formatting, missing chat IDs, broadcast-to-additional-chat, etc.), tell me what specifically — but the pipe itself is healthy.

## The change (small, two files)

**File 1: `supabase/functions/_shared/parlay-engine-v2/config.ts`**

Drop the global leg-confidence floor from `0.65` → `0.60` and update the `live` preset path used by production. Specifically:

```ts
// before
export const MIN_LEG_CONFIDENCE = 0.65;
export const PREFERRED_LEG_CONFIDENCE = 0.72;

// after
export const MIN_LEG_CONFIDENCE = 0.60;        // restored
export const PREFERRED_LEG_CONFIDENCE = 0.68;  // scaled down to keep the same gap
```

`S_TIER_CONFIDENCE_OVERRIDE` stays at `0.60` (already there). The `kelly_lite` stake multiplier auto-rescales because it's based on the gap above `MIN_LEG_CONFIDENCE`.

Also update the two preset rows so backtests/parity stay aligned:
```ts
"v2.2":          { MIN_LEG_CONFIDENCE: 0.60, ... }
"v2.3-balanced": { MIN_LEG_CONFIDENCE: 0.60, ... }
// "v2.3-max-ROI" stays at 0.75 — that's the deliberately strict preset
```

**File 2: `supabase/functions/parlay-engine-v2/index.ts`**

After deploying, re-invoke the function for today (`date: 2026-04-26`, `preset: "live"`) so the slate rebuilds against the new floor. No code change here — just a trigger.

## Verification flow once deployed

1. **Confirm the floor moved**: read back `config.ts` after deploy.
2. **Re-run the engine**: `parlay-engine-v2` with `{ date: "2026-04-26", preset: "live" }`. Expect candidate-kept count to roughly double, and parlays_built to climb from 4 → ~10-15.
3. **Trigger broadcast**: invoke `parlay-engine-v2-broadcast` with `{ date: "2026-04-26" }`. Already-sent parlays are dedup'd by `bot_parlay_broadcasts.parlay_id`, so only the *new* ones go out — no spam.
4. **Confirm Telegram delivery**: query `bot_parlay_broadcasts` and check the chat. Should see ~6-11 new rows, all with `telegram_message_id` populated.

## Files I will NOT touch

- `parlay-engine-v2-broadcast/index.ts` — already working, sent today's 4 parlays cleanly.
- The same-game concentration cap (`0.75`) — staying as-is per `mem://logic/parlay/same-game-concentration` until pool coverage is proven stable.
- The S-tier override (already 0.60).
- The 0.75 strict preset (`v2.3-max-ROI`) — that's the conservative variant.

## Risks + mitigations

- **More legs in the pool means more chance of borderline picks.** That's the trade-off you're accepting; if quality slips noticeably tomorrow we can bump back to 0.62 as a midpoint. The hit-rate-based PROP_WHITELIST scoring multipliers still apply, so genuinely weak signals still get downranked even if they pass the floor.
- **Telegram volume goes up.** Expect ~10-15 messages instead of ~4 per slate. Per-message rate limit (1.2s sleep) already handles this.
- **No DB migration needed.** Pure TypeScript constant change.

## Outcome

- Confidence floor restored to 0.60 across `MIN_LEG_CONFIDENCE` and the matching presets.
- Engine rebuilds today's slate against the looser floor, lifting parlay count from 4 toward the 8-15 range.
- Broadcaster auto-picks up the new parlays (dedup is per-parlay-ID, so no double-sends) and pushes them to chat `7705141526`.
- You see the additional parlays land in Telegram within a few minutes of the rebuild.

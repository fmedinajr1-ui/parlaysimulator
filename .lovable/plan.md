

## Telegram Alert Format v3 — Plan

### What you have today
- **Dispatcher** (`bot-send-telegram`): thin transport, supports `message` (v2) or `{type,data}` (legacy compat).
- **Two formatters**:
  - `pick-formatter.ts` — clean v2 cards (playcard, parlay card, accuracy pulse, settled leg).
  - `alert-enricher.ts` — wraps legacy alerts with a humor opener + accuracy badge + stake footer.
- **74 generators** still invoke the dispatcher; ~half pass raw `{type, message}`, the rest send free-form text.

### Problems
1. **No visual hierarchy** — every alert looks the same scroll of text. A 90% lock and a 55% dart read identically until you read the words.
2. **Enricher is a wrapper, not a renderer** — it bolts a header + footer onto whatever raw string the generator built. Inconsistent body formatting across the 99 legacy types.
3. **No "at-a-glance" line** — customers have to read 3-4 lines to know sport, side, stake, and conviction.
4. **No live context** — alert doesn't show line at alert time vs current line, or game status (T-2hr, live Q2, etc.).
5. **Personalization is just stake $** — no read on whether THIS customer should fade, follow, or skip based on their bankroll posture.
6. **Settlements are buried** — when an alerted pick hits, there's no callback message tying back to the original alert.

---

### v3 Format Spec

Every alert renders as 4 zones:

```text
🏀 STRIKE · 87% · LeBron O25.5 PTS  ← Glance line (1 line, bot-mood emoji + tier + headline)
━━━━━━━━━━━━━━━━━
[Body — voice + drivers + recency, max 5 lines]
━━━━━━━━━━━━━━━━━
📈 L7: 73% (12) · Line: -110 → -118 · Tip: 2h14m   ← Context strip
💵 $150 · 3% bankroll · validation tier            ← Stake strip
_Closer line._                                      ← Voice closer
```

**Glance line rules**
- Emoji = `bot mood` derived from form (🔥/✅/⚠️/🥶) + sport
- ALL CAPS verb tier: `STRIKE` (execution), `WATCH` (validation), `DART` (exploration), `FADE`, `SKIP`
- Confidence as integer %
- Pick in 6-8 chars max (`LeBron O25.5 PTS`)

**Context strip**
- L7 hit-rate + sample (already in `accuracy-lookup`)
- Line at alert vs current (new — pulled from `line_movements` if available)
- Time-to-tip (new — pulled from `commence_time`)

**Stake strip**
- Already produced by `getStakeRecommendation`, just make it its own row.

**Settlement callback** (new)
- When a pick settles, dispatcher checks `bot_message_log.reference_key` for the original alert and sends a follow-up: `✅ Called it. LeBron 31 PTS — that's STRIKE #14 today.` instead of an isolated settlement.

---

### Build plan

**1. New module: `_shared/alert-format-v3.ts`**
- `renderAlertCardV3(input)` — the 4-zone renderer above. Inputs: pick/raw text, accuracy, stake, line context, game context.
- `glanceLine(tier, sport, confidence, headline)`
- `contextStrip(accuracy, lineNow, lineThen, tipTime)`
- `stakeStrip(stakeAdvice, bankroll)`
- Reuses existing `voice.ts` for openers/closers and `pick-formatter.ts` helpers.

**2. Upgrade `alert-enricher.ts`**
- Replace the "header + raw + footer" wrap with `renderAlertCardV3` so legacy generators get the new format **without code changes**.
- Try to extract sport/side/line/odds from the raw text via the same regex patterns already used in `pp-props-scraper`. Fall back to wrapper-only if extraction fails.
- Keep `DISABLE_ENRICHMENT=true` rollback.

**3. Add line + tip context fetcher**
- New helper `_shared/alert-context.ts`:
  - `getLineContext(eventId, marketKey)` → `{ openLine, currentLine, movementPct }` from `line_movements`.
  - `getGameContext(eventId)` → `{ tipInMinutes, status }` from `events` table.
- Cached per-invocation like `accuracy-lookup`.

**4. Settlement callback**
- In `bot-settle-and-learn`, when a settlement message is built, query `bot_message_log` for `reference_key` matching the pick id. If found, prepend `🎯 Called this at {time}.` to the settlement message.
- Adds zero new tables — `reference_key` and `bot_message_log` already exist.

**5. Per-customer voice line** (lightweight personalization)
- In dispatcher fanout `personalize` callback, append a one-line read based on the customer's recent W/L:
  - Customer up 7-day → `_You're hot — full size._`
  - Customer down 7-day → `_Rough patch — half size, no chase._`
- Pulls from `customer_recent_results` (table already exists per the bankroll-curator usage).

**6. Generator-side opt-in for v2-native callers (~30 functions)**
- Add a `format_version: 'v3'` flag to the dispatcher body. If set, dispatcher trusts the message as already-formatted. Default behavior unchanged.
- Migrate `bot-curated-pipeline`, `gold-signal-parlay-engine`, `final-verdict-engine`, `fanduel-prediction-alerts`, `pregame-scanlines-alert` to call `renderAlertCardV3` directly. Other 65+ generators inherit the new format via the upgraded enricher.

**7. QA**
- Per the testing-policy memory: 5 verifications before broadcast. I'll send 5 sample alerts to admin-only (one per tier: STRIKE, WATCH, DART, FADE, SKIP) and screenshot them in Telegram before fanout is enabled.

---

### Out of scope
- No new DB tables.
- No changes to `telegram-webhook` (inbound bot commands).
- Existing parlay/playcard/settlement-story formats stay — they already follow a clean structure.
- No public-facing UI changes.

### Rollback
- `DISABLE_ENRICHMENT=true` reverts legacy generators to raw text instantly.
- `format_version: 'v2'` (default) bypasses v3 renderer for any caller that opts back.

### Open questions (decide after approval)
- Want **emoji bot-mood** (🔥/✅/⚠️/🥶 driven by form) on the glance line, or keep it sport-only for cleanliness?
- Want the per-customer voice line on **every alert**, or only on STRIKE-tier (high-stake) ones?


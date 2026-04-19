

User wants: 
1. Every generator/alert in pipeline gets stake advice (not just the 4 v2 generators)
2. Bot personality with humor across ALL alerts
3. Real-time accuracy reporting per alert type so customers know if today is a "bet bigger" day or "tighten up" day
4. Bot becomes the unified voice across the whole pipeline — not just orchestrator phases

Current state:
- Phase 4 done: bankroll-curator + voice 2.0 working for 4 v2 generators going through orchestrator
- ~99 legacy generators still send `{type, data}` through compat shim → no stake advice, no personality, generic legacy text
- 13 direct-API bypasses skip the dispatcher entirely
- No per-alert-type accuracy lookup → bot can't say "RBI unders are 8/10 this week, size up"

Let me check what exists for accuracy tracking and what the legacy alert types look like to scope this properly.
- `signal_accuracy` table exists per memory (mem://logic/betting/accuracy-segmentation)
- `bot_message_log` from Phase 1 logs every send with reference_key
- voice.ts has form-aware openers but no humor layer or per-alert-type accuracy injection

# Bot Comes Alive — Stake Advice + Humor + Accuracy on Every Alert

## What I'll build

### 1. New shared lib: `_shared/alert-enricher.ts`
The single function every legacy `{type, data}` payload now passes through inside the dispatcher. It takes raw legacy text and:
- Looks up that alert type's 7-day accuracy from `signal_accuracy` (e.g., RBI under = 73%, FanDuel cascade = 61%)
- Pulls current `bot_bankroll_state` (form, bankroll, daily exposure used)
- Computes a **stake recommendation** for THIS alert based on its tier + today's accuracy + current form:
  - High accuracy alert type (>70% L7) on hot streak → "Size up: $300 unit"
  - Mid accuracy (55-70%) on neutral form → "Standard: $150"
  - Low accuracy (<55%) or cold streak → "Light: $50, tracking only"
  - Below 45% L7 → "Skip — this signal type is bleeding"
- Injects a **humor/personality wrapper** around the original message (header + footer)
- Returns enriched markdown ready to send

### 2. Add humor layer to `_shared/voice.ts`
Extend (don't replace) with:
- `humorLines.openers` (~30 rotating): "Bookies hate this one trick.", "Found another mispricing while you were sleeping.", "The line moved. I noticed. You're welcome."
- `humorLines.closers` (~30): "Cash it.", "This one's free. The next one costs.", "Don't tell your accountant.", "I'll be here all night."
- `humorLines.cold_streak` (~15): "Last 3 days: rough. Doubling the homework, halving the stakes.", "Even the algorithm has bad nights. Sizing down."
- `humorLines.hot_streak` (~15): "5 of 6 yesterday. Pressing the advantage.", "Riding it until the wheels fall off."
- `pickHumor(seed)` — deterministic per pick so same alert doesn't get re-rolled on retries
- `accuracyPhrase(pct)` — "🔥 hitting 78% this week" / "📊 60% — middle of the road" / "⚠️ 41% — fade-only territory"

### 3. New shared lib: `_shared/accuracy-lookup.ts`
- `getAlertTypeAccuracy(alertType, days=7)` — reads `signal_accuracy` table by signal_type, returns `{l7_hit_rate, l30_hit_rate, sample_size, trend}`
- `getStakeRecommendation(accuracy, form, exposureUsedPct)` — pure function returning `{stake: number, tier: string, reasoning: string}`
- Cached in-memory per dispatcher invocation (avoid hammering DB on burst sends)
- Falls back to "neutral" stake if signal type unknown

### 4. Update `bot-send-telegram/index.ts` (the dispatcher)
This is the keystone — every alert in the pipeline already routes here. We add the enrichment step in compat path:

```ts
if (compatMode && body.type) {
  const enriched = await enrichLegacyAlert(body); // adds stake + accuracy + humor
  body.message = enriched.message;
  body.parse_mode = 'Markdown';
  // log enrichment metadata for tracking
  body._enrichment = { stake: enriched.stake, accuracy: enriched.accuracy };
}
```

This means **all 99 legacy generators get the upgrade automatically** — no need to touch each one.

### 5. New table: `alert_type_accuracy_cache`
- `alert_type` text PK
- `l7_hit_rate`, `l30_hit_rate`, `sample_size_l7`, `trend` ('hot'|'neutral'|'cold')
- `stake_multiplier` numeric (computed: 1.5x for hot+high-acc, 0.5x for cold/low-acc)
- `last_updated`
- Refreshed every 30 min by a new edge function `refresh-alert-accuracy`

Why a cache table: `signal_accuracy` is hit hard already; the dispatcher fires hundreds of times/day and needs sub-50ms lookups.

### 6. New edge function: `refresh-alert-accuracy`
- Aggregates `signal_accuracy` and `engine_live_tracker` settled outcomes
- Groups by alert type / signal type
- Writes to `alert_type_accuracy_cache`
- Cron: every 30 min during active hours (10a-11p ET)

### 7. New orchestrator phase: `accuracy_pulse`
A new mid-day broadcast (3p ET) that uses the cache to summarize the day's signal health:
> "📊 Mid-day pulse:
> 🔥 RBI Unders — 8/10 last 7 days. Sizing up.
> 🔥 SB Overs — 73% L7. Loading up.
> 📊 FanDuel Cascade — 58%. Standard size.
> ⚠️ NBA Bench Unders — 41% L7. Sitting out today.
> 
> Today's read: green light on baseball, tap the brakes on NBA props."

### 8. Update `_shared/pick-formatter.ts`
- All cards (legacy or new) now show: `💵 Stake: $300 (hot streak + 73% L7 on this signal type)`
- Add accuracy badge per card: `🔥 78% L7` or `⚠️ 42% L7` next to confidence
- Add `renderAccuracyPulse(signalAccuracies)` for the new orchestrator phase

## Files touched

**Create:**
- `supabase/functions/_shared/alert-enricher.ts`
- `supabase/functions/_shared/accuracy-lookup.ts`
- `supabase/functions/refresh-alert-accuracy/index.ts`

**Modify:**
- `supabase/functions/_shared/voice.ts` (add humor banks + accuracy phrasing)
- `supabase/functions/_shared/pick-formatter.ts` (stake + accuracy badges, new pulse renderer)
- `supabase/functions/bot-send-telegram/index.ts` (call enricher in compat path)
- `supabase/functions/orchestrator-daily-narrative/index.ts` (add `accuracy_pulse` phase at 3p ET)

**DB migration:**
- New table `alert_type_accuracy_cache` (RLS service-role only)
- Cron entries: `refresh-alert-accuracy` every 30 min, orchestrator already runs every 5 min

**No changes to:** any of the 99 legacy generators, the 13 direct-API callers (those bypass us — separate cleanup loop), frontend.

## How "bet bigger today?" gets answered
Three signals combine into the stake recommendation shown on every alert:
1. **This signal type's L7 accuracy** (cached, refreshed 30 min)
2. **Bot's current form** from `bot_bankroll_state` (last 3-day P&L)
3. **Daily exposure remaining** (don't recommend $300 if we've already used 18% of 20% cap)

Every alert footer reads like:
> 💵 **Stake: $250** — RBI Unders 8/11 L7 + bot riding hot streak. Could press to $300 but exposure at 14% — staying disciplined.

## Risk + rollback
- **Risk**: enrichment adds DB lookup latency on every dispatcher call. Mitigation: in-memory cache per invocation + the dedicated cache table.
- **Risk**: humor lines could feel forced if same one shows up twice. Mitigation: deterministic seed per alert + 30+ variants per category.
- **Rollback**: set `DISABLE_ENRICHMENT=true` env var → dispatcher skips enricher and uses raw legacy text exactly like today.

## Testing (project policy: 5 verifications)
1. Send legacy `{type:'rbi_alert', data:{...}}` → verify enriched output has stake + accuracy + humor
2. Send same alert twice → verify deterministic humor (same line both times)
3. Mock cold streak in `bot_bankroll_state` → verify stakes auto-halve in next alert
4. Mock signal type with 40% L7 → verify "fade-only" or skip recommendation
5. Force `accuracy_pulse` orchestrator phase → verify mid-day summary message
6. Set `DISABLE_ENRICHMENT=true` → verify bypass works (rollback safety)

## What does NOT change
- All 99 legacy generators stay untouched (compat shim handles them)
- Phase 3 v2 generators (RBI v2, SB, NBA bench, cross-sport) keep their richer playcard format — enrichment skips them since they already have stake info
- `bot_daily_picks`, `bot_bankroll_state` schemas unchanged
- Frontend, blog, settlement engine, hedge tracker — zero touch


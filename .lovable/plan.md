

## Full Engine Refresh + High Conviction Telegram Report

### Step 1: Run Risk Engine (Full Slate)

Invoke `nba-player-prop-risk-engine` with `{ action: 'analyze_slate', mode: 'full_slate' }` to populate today's risk engine picks, creating more potential overlaps with the 157 mispriced lines already detected.

### Step 2: Add High Conviction Report to Telegram Bot

**Modified file: `supabase/functions/bot-send-telegram/index.ts`**

1. Add `'high_conviction_report'` to the `NotificationType` union
2. Create `formatHighConvictionReport(data, dateStr)` formatter:

```
Format:
🎯 HIGH CONVICTION PLAYS — Feb 20
================================

🔥 12 cross-engine overlaps found
✅ 8 with full side agreement

🏆 TOP PLAYS (sorted by conviction score):

1. 🏀 Dean Wade — AST O 1.5
   📈 Edge: +180% (ELITE)
   ✅ Risk + Sharp agree OVER
   🎯 Score: 28.5/30

2. 🏀 Jarrett Allen — BLK O 0.5
   📈 Edge: +100% (ELITE)
   ✅ Risk agrees OVER
   🎯 Score: 24.2/30

...
```

3. Shows top 15 plays by conviction score
4. Includes engine confirmation details and side agreement status

### Step 3: Create Server-Side Cross-Reference Edge Function

**New file: `supabase/functions/high-conviction-analyzer/index.ts`**

This edge function replicates the client-side logic from `useHighConvictionPlays.ts` but runs server-side so it can:

1. Query `mispriced_lines` for today
2. Query all engine tables (`nba_risk_engine_picks`, `prop_engine_v2_picks`, `sharp_ai_parlays`, `heat_parlays`)
3. Normalize prop types and cross-reference
4. Compute conviction scores
5. Call `bot-send-telegram` with `type: 'high_conviction_report'` and the top plays

### Step 4: Wire Into Pipeline

**Modified file: `supabase/functions/detect-mispriced-lines/index.ts`**

After the existing Telegram report fires, also call `high-conviction-analyzer` so the cross-engine overlap report is sent automatically after mispriced line detection completes.

### Files Summary

| Action | File |
|--------|------|
| Modify | `supabase/functions/bot-send-telegram/index.ts` (add high_conviction_report type + formatter) |
| Create | `supabase/functions/high-conviction-analyzer/index.ts` (server-side cross-reference + Telegram trigger) |
| Modify | `supabase/functions/detect-mispriced-lines/index.ts` (chain call to high-conviction-analyzer) |

### Immediate Actions (after code changes)

1. Deploy all 3 edge functions
2. Invoke `nba-player-prop-risk-engine` with full_slate mode
3. Invoke `high-conviction-analyzer` to compute overlaps and send to Telegram
4. Verify Telegram receives both reports (mispriced lines + high conviction overlaps)


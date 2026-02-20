

## Fix Telegram Bot: Show All Parlays with Pagination

### Problems Identified

1. **Latest Batch Filter**: The `/parlays` handler only shows parlays created within 5 minutes of the most recent one. Parlays from earlier runs (like the force-generated ones) are completely invisible.

2. **Missing Strategy Classification**: `force_mispriced_conviction` and `mispriced_edge` strategies don't match any tier keywords, so they silently fall into "Exploration" instead of being shown as "Execution" tier.

3. **No Pagination**: With 44+ parlays, the full list is too long for a single viewing. There's no way to page through or expand.

4. **Notification Shows 0/0/0**: The `tiered_parlays_generated` notification passes `exploration: 0, validation: 0, execution: 0` from the force-fresh function, so the summary looks empty even though parlays were created.

---

### Fix 1: Remove "Latest Batch" Filter from `/parlays`

**File: `supabase/functions/telegram-webhook/index.ts`**

Replace the 5-minute batch window with showing ALL of today's pending (unsettled) parlays. This ensures force-generated and multi-run parlays are always visible.

### Fix 2: Add New Strategy Names to Tier Classification

**File: `supabase/functions/telegram-webhook/index.ts`**

Update the tier grouping logic to recognize:
- `force_mispriced_conviction` -> Execution tier
- `mispriced_edge` -> Execution tier
- Any strategy containing `mispriced` or `conviction` -> Execution tier

### Fix 3: Add Pagination with Inline Keyboard

**File: `supabase/functions/telegram-webhook/index.ts`**

- Show max 5 parlays per message
- Add "Show More" inline button that reveals the next batch
- Add a callback handler for `parlays_page:N` to send the next page
- Include a summary header: "Showing 1-5 of 44 parlays"

### Fix 4: Improve the Notification Summary

**File: `supabase/functions/bot-send-telegram/index.ts`**

Update `formatTieredParlaysGenerated` to count parlays from the DB when all tier counts are 0, breaking them down by actual strategy names so the notification accurately reflects what was generated.

---

### Technical Details

**Pagination callback flow:**
- `/parlays` sends first page (5 parlays) with "Next 5 >" button
- User taps button, triggers callback `parlays_page:2`
- Bot sends next 5 parlays with "< Prev 5 | Next 5 >" buttons
- Last page only shows "< Prev 5"

**Strategy-to-tier mapping update:**
```
execution keywords: execution, elite, cash_lock, boosted_cash, golden_lock,
                    hybrid_exec, team_exec, mispriced, conviction, force_
validation keywords: validation, validated, proving
everything else: exploration
```

### Files Changed

| Action | File |
|--------|------|
| Modify | `supabase/functions/telegram-webhook/index.ts` (remove batch filter, add pagination, fix tier mapping) |
| Modify | `supabase/functions/bot-send-telegram/index.ts` (fix 0/0/0 notification) |


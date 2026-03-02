

# Fix `/sweetspots` Command: Show Full Pool with Pagination

## Problem
The current `handleSweetSpots` function hard-filters on `is_active = true`, `l10_hit_rate >= 0.70`, and `confidence_score >= 0.75`, which eliminates most picks. It also caps display at 25 with no pagination -- you can't see everything.

## Changes

### File: `supabase/functions/telegram-webhook/index.ts`

#### 1. Rewrite `handleSweetSpots` with pagination (lines 3354-3414)

- Change signature to `handleSweetSpots(chatId: string, page = 1)`
- Remove all hard filters (`is_active`, `l10_hit_rate`, `confidence_score`) from the query
- Fetch ALL of today's sweet spots ordered by `l10_hit_rate DESC`, limit 200
- Add `PER_PAGE = 10` pagination matching the existing pattern (mispriced, highconv, etc.)
- Cross-reference with `unified_props` to tag picks as `[LIVE]` or `[--]`
- Show per pick: player, prop type, side, line, L10 hit rate, confidence, category, live status
- Add `sweetspots_page:N` pagination buttons (Prev/Next)
- Use `sendLongMessage` + separate pagination button message

#### 2. Wire up pagination callback (around line 2416)

Add after the `pitcherk_page` handler:

```text
} else if (data.startsWith('sweetspots_page:')) {
  const page = parseInt(data.split(':')[1], 10) || 1;
  await answerCallbackQuery(callbackQueryId, `Loading page ${page}...`);
  await handleSweetSpots(chatId, page);
}
```

#### 3. Update `/sweetspots` call site (line 3775)

The command already calls `handleSweetSpots(chatId)` which returns a string. Since the new version uses `sendLongMessage` directly (like `handleMispriced`), change it to:

```text
if (cmd === "/sweetspots") { await handleSweetSpots(chatId); return null; }
```

This matches how other paginated commands work -- they send messages directly and return `null`.

## Deployment

Deploy updated `telegram-webhook` edge function.


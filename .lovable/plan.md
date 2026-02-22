

## Fix Hedge Lines: Match Your Sportsbook + Smart Line Filter

### Problem
1. **Wrong book lines** -- The system fetches lines from FanDuel/DraftKings only. You're on Hard Rock, so the hedge alert shows a line that doesn't match what you see.
2. **No smart line selection** -- The system grabs the first book's line it finds. It should compare across multiple books and pick the **best line for the recommended side** (lowest line for OVER, highest line for UNDER).

### Solution

#### Part A: Add Hard Rock + Fetch ALL Books
Update the edge function and hooks to fetch from Hard Rock, FanDuel, and DraftKings simultaneously, returning **all available lines** instead of just the first match.

#### Part B: Smart Line Filter
On the client side, when building hedge alerts, pick the **smartest line** from the returned set:
- If recommending **OVER**: use the **lowest available line** (easiest to clear)
- If recommending **UNDER**: use the **highest available line** (most room underneath)

This way even if Hard Rock has 19.5 but FanDuel has 17.5, and the system recommends OVER, it'll show "BET OVER 17.5 (FanDuel)" -- the best deal across books.

### File Changes

**1. `supabase/functions/fetch-current-odds/index.ts`**
- Add `'hardrockbet'` to `PRIORITY_BOOKMAKERS`
- New function `findAllPlayerOdds()` that returns lines from ALL matching bookmakers (not just the first hit)
- New request param `return_all_books: true` triggers multi-book response
- Response shape adds `all_odds: [{ line, over_price, under_price, bookmaker, bookmaker_title }]` alongside the existing single `odds` field for backward compatibility

**2. `src/hooks/useLiveSweetSpotLines.ts`**
- Update `preferred_bookmakers` to `['hardrockbet', 'fanduel', 'draftkings']`
- Pass `return_all_books: true` and `search_all_books: true`
- Store all book lines in `LiveLineData` as new field `allBookLines`

**3. `src/hooks/useLiveSweetSpotLines.ts` -- `LiveLineData` interface**
- Add `allBookLines?: { line: number; bookmaker: string; overPrice?: number; underPrice?: number }[]`

**4. `src/hooks/useLiveOdds.ts`**
- Update `preferred_bookmakers` to include `'hardrockbet'`

**5. `src/components/scout/warroom/WarRoomLayout.tsx`**
- Smart line picker logic in the hedge opportunity builder:
  - Get `allBookLines` from the spot's live data
  - If side is OVER: pick the line with the **lowest value** (easiest to clear)
  - If side is UNDER: pick the line with the **highest value** (most room)
  - Display which book the line comes from in the `suggestedAction` (e.g., "BET OVER 17.5 @ FanDuel")

**6. `src/components/scout/warroom/HedgeSlideIn.tsx`**
- Add `bookmaker` field to `HedgeOpportunity` interface
- Display the book source below the action (e.g., "via FanDuel") so you know which app to open

### Smart Line Example

Player projection: 18.0

| Book | Line |
|------|------|
| Hard Rock | 19.5 |
| FanDuel | 17.5 |
| DraftKings | 18.5 |

- Projection (18.0) < all 3 lines, so system recommends UNDER
- For UNDER, pick **highest line** = Hard Rock 19.5 (most room)
- Alert shows: **BET UNDER 19.5 @ Hard Rock**

If projection were 20.0 (recommending OVER):
- For OVER, pick **lowest line** = FanDuel 17.5 (easiest to clear)
- Alert shows: **BET OVER 17.5 @ FanDuel**

### Result
- Hedge alerts will show lines from the book that gives you the best edge
- You'll know exactly which app to open to place the bet
- Hard Rock is now a supported and prioritized source

### 6 files modified. Edge function redeployed. No database changes.


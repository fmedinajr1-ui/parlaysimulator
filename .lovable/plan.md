

## Mispriced Lines Dashboard Card + Daily Telegram Report

### Part 1: Dashboard UI Component

**New file: `src/components/market/MispricedLinesCard.tsx`**

A card component following the same pattern as `SweetSpotPicksCard` that displays today's mispriced lines with filtering:

- **Data fetch**: Query `mispriced_lines` table for today's date (Eastern Time), ordered by `ABS(edge_pct)` descending
- **Filter controls** at the top:
  - **Sport tabs**: ALL | NBA | MLB (filters by `sport` column)
  - **Signal chips**: ALL | OVER | UNDER (filters by `signal` column)
  - **Confidence chips**: ALL | ELITE | HIGH | MEDIUM (filters by `confidence_tier`)
- **Each row displays**:
  - Player name
  - Prop type (formatted)
  - Book line vs Player avg (L10/season)
  - Edge % with color coding (green for OVER, red for UNDER, intensity by magnitude)
  - Signal badge (OVER/UNDER)
  - Confidence tier badge (ELITE = gold, HIGH = green, MEDIUM = blue)
  - Sport icon (basketball/baseball)
- **Shooting/Baseball context** expandable per row showing FG%/3P%/FT% for NBA or AVG/OBP/SLG/OPS for MLB
- **Summary header**: Shows counts (e.g., "157 NBA | 0 MLB | 55 OVER | 102 UNDER")
- **Refresh button**: Invokes `detect-mispriced-lines` edge function

### Part 2: Add to Homepage

**Modified file: `src/pages/Index.tsx`**

Add the `MispricedLinesCard` component between the Elite 3PT section and the Daily Parlay Hub section on the homepage.

### Part 3: Telegram Daily Report

**Modified file: `supabase/functions/bot-send-telegram/index.ts`**

1. Add `'mispriced_lines_report'` to the `NotificationType` union
2. Add a `formatMispricedLinesReport(data, dateStr)` function that formats the report:

```
Format:
🔍 MISPRICED LINES REPORT — Feb 20

📊 NBA: 157 lines | ⚾ MLB: 0 lines
🟢 55 OVER | 🔴 102 UNDER

🏆 ELITE EDGES:
📈 Dean Wade — Assists O 1.5 | Avg: 4.2 | Edge: +180%
📈 Jarrett Allen — Blocks O 0.5 | Avg: 1.0 | Edge: +100%
...

🔥 HIGH CONFIDENCE:
📉 Kobe Brown — Points U 8.5 | Avg: 3.1 | Edge: -64%
...
```

3. Groups by confidence tier (ELITE first, then HIGH, then MEDIUM)
4. Shows top 10-15 per tier to keep message manageable
5. Uses existing `sendToTelegram` long-message splitting

**Modified file: `supabase/functions/detect-mispriced-lines/index.ts`**

After persisting results, automatically call `bot-send-telegram` with `type: 'mispriced_lines_report'` and pass the summary data (counts + top picks by tier). This fires every time the detector runs in the pipeline, giving a daily Telegram delivery.

### Files Summary

| Action | File |
|--------|------|
| Create | `src/components/market/MispricedLinesCard.tsx` |
| Modify | `src/pages/Index.tsx` (add card to homepage) |
| Modify | `supabase/functions/bot-send-telegram/index.ts` (add report type + formatter) |
| Modify | `supabase/functions/detect-mispriced-lines/index.ts` (trigger Telegram after analysis) |


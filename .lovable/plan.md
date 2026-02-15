

# Add Research Intelligence Panel to Admin + Bot Dashboard

## What This Adds

A new "Research Intelligence" section that shows you exactly what the AI research agent found -- every Perplexity query, every finding, and how it influenced today's parlays.

## Two Access Points

### 1. Admin Panel -- Full Research Dashboard (new admin section)

A new "Research Intelligence" card in the Admin overview that opens a full dashboard showing:

- **Today's Research Findings**: All entries from `bot_research_findings` for today, grouped by category (e.g., `ncaab_team_scoring_trends`, `ncaab_scoring_validation`, `sharp_signals`)
- **Finding Details**: Each finding shows the category, source query, key findings text, relevance score, and whether an action was taken (e.g., "boosted score +7" or "added to blocklist")
- **Research Timeline**: When each finding was fetched, with status indicators (success/empty/error)
- **Historical View**: Date picker to review past days' research

### 2. Bot Dashboard -- Compact Research Summary Card

On the homepage Bot Dashboard, add a small collapsible card above or below the daily parlays showing:

- Number of research findings today (e.g., "14 findings from 6 categories")
- Quick status: how many had high relevance (above 0.7) vs low
- Last research run timestamp
- A "View Details" link that navigates to the Admin research panel (admin only) or expands inline

## Technical Details

### New Files

1. **`src/components/admin/ResearchIntelligencePanel.tsx`** -- Full admin dashboard component
   - Fetches from `bot_research_findings` table filtered by date
   - Groups findings by `category`
   - Displays `key_findings` text, `relevance_score`, `action_taken`, `created_at`
   - Date picker for historical browsing
   - Color-coded relevance badges (green > 0.7, yellow 0.4-0.7, red < 0.4)

2. **`src/components/bot/ResearchSummaryCard.tsx`** -- Compact card for the Bot Dashboard
   - Shows today's research count and relevance summary
   - Collapsible to show category breakdown
   - Accessible to all users (read-only summary)

### Modified Files

3. **`src/pages/Admin.tsx`**
   - Add `'research'` to `AdminSection` type
   - Add Research Intelligence card to `sectionConfig` array (with `Search` or `BookOpen` icon)
   - Add case in `renderSectionContent` to render `ResearchIntelligencePanel`

4. **`src/pages/Index.tsx`** (or wherever the Bot Dashboard lives)
   - Import and render `ResearchSummaryCard` above/below `DailyParlayHub`

### Database Query

The panel reads directly from the existing `bot_research_findings` table:
```sql
SELECT category, key_findings, relevance_score, action_taken, source_query, created_at
FROM bot_research_findings
WHERE research_date = '2026-02-15'
ORDER BY created_at DESC
```

No schema changes needed -- all data already exists.

### UI Design

- Matches existing admin panel card style (dark theme, muted borders)
- Category grouping with collapsible sections
- Relevance score shown as colored badge (green/yellow/red)
- Action taken shown as a small tag (e.g., "blocklist", "score boost +7", "no action")
- Empty state: "No research findings for this date. Run the AI Research Agent to generate."


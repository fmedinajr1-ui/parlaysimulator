
# Show Full Research Reports

## Problem
Research finding summaries are truncated to 3 lines (`line-clamp-3`), hiding the full report content. The `key_insights` and `sources` data are also not displayed.

## Solution
Make each finding card expandable to show the full report, including:
- Full summary text (remove line-clamp)
- Key insights list (from `key_insights` field)
- Clickable source links (from `sources` array)

## Technical Details

### Modified File: `src/components/admin/ResearchIntelligencePanel.tsx`

1. Add `expandedFindings` state (`Set<string>`) to track which findings are expanded
2. Replace the static `line-clamp-3` summary with a toggleable view:
   - Collapsed: 3-line clamp with "Show more" button
   - Expanded: full summary + key insights + source links
3. Each finding card becomes clickable to toggle expand/collapse
4. When expanded, render:
   - Full `summary` text (no clamp)
   - `key_insights` as a bulleted list (if present)
   - `sources` as clickable links (if present)

### UI Structure (expanded state)
```
[Title]                    [85%] [Applied to generation...]
Full summary text without truncation...

Key Insights:
  - Insight 1
  - Insight 2

Sources:
  source1.com  source2.com  ...

12:01 PM                                      5 sources
```

Single file change, no database modifications.

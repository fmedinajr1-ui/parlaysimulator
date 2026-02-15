

# Add Research Tab to Bot Dashboard

## What Changes

Add a fourth tab "Research" to the Bot Dashboard's existing tab bar (Overview, Parlays, Analytics, **Research**) that renders the full `ResearchIntelligencePanel` inline.

## Technical Details

### Modified File: `src/pages/BotDashboard.tsx`

1. Add import for `ResearchIntelligencePanel` from `@/components/admin/ResearchIntelligencePanel`
2. Add a new `TabsTrigger` with value `"research"` to the `TabsList`
3. Add a new `TabsContent` with value `"research"` that renders `<ResearchIntelligencePanel />`

The existing `ResearchSummaryCard` in the Overview tab stays as-is for a quick glance.

### Changes Summary

```
TabsList:
  Overview | Parlays | Analytics | Research  <-- new tab added

TabsContent value="research":
  <ResearchIntelligencePanel />  <-- already built, just needs to be wired in
```

No new files, no database changes. Single file edit.


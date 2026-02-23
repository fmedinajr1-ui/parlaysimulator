

## Remove Simulation and Research Tabs from Dashboard

Remove the "Simulation" tab and "Research" tab (and their content) from the Bot Dashboard.

### Changes

**File: `src/pages/BotDashboard.tsx`**
- Remove imports: `SimulationAccuracyCard` (line 21), `ShadowPicksFeed` (line 22), `ResearchIntelligencePanel` (line 18)
- Remove `<TabsTrigger value="research">` (line 180)
- Remove `<TabsTrigger value="simulation">` (line 181)
- Remove `<TabsContent value="research">` block (lines 284-287)
- Remove `<TabsContent value="simulation">` block (lines 289-293)

The components themselves remain in the codebase, just no longer rendered on the dashboard.

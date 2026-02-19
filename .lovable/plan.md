

## Demo/Preview Mode for Customer Scout View

### Problem
When no game is live, customers see a blank "No game is currently live" message. This gives no sense of what the Scout experience looks like and doesn't build excitement.

### Solution
Show a fully populated demo version of the Command Center using hardcoded sample data, with a clear "DEMO" banner so customers know it's a preview.

### What Customers Will See

```text
[DEMO BANNER - "Preview Mode - Live data appears when a game starts"]
[Stream Panel - "Lakers vs Celtics" demo matchup]
[Slip Scanner]
[Props cards - 4-5 sample picks with hit rates + edges]
[Pick Status - sample ON TRACK / CAUTION indicators]
[Confidence Dashboard - sample heat meters at various %]
[Risk Mode Toggle]
[AI Whisper - sample insights rotating]
```

### Implementation

**1. New file: `src/data/demoScoutData.ts`**
- Export a demo `ScoutGameContext` (Lakers vs Celtics)
- Export sample confidence picks (5 players with realistic current values)
- Export sample whisper picks (same picks with game progress)
- Export a sample whale signals Map with 1-2 entries

**2. Update: `src/pages/Scout.tsx`**
- When `isCustomer && !selectedGame && !activeGame`, instead of showing the empty message, render the `CustomerScoutView` wrapped in `RiskModeProvider` using the demo game context
- Pass a `isDemo={true}` prop to `CustomerScoutView`

**3. Update: `src/components/scout/CustomerScoutView.tsx`**
- Accept optional `isDemo` prop
- When `isDemo` is true:
  - Show a subtle banner at the top: "Preview Mode" with a pulsing dot
  - Use the demo confidence picks and whisper picks instead of live data (which would be empty)
  - Still render all 7 modules so customers see the full layout
- The Slip Scanner, Risk Toggle, and Sweet Spot Props work independently and don't need demo data
- The Confidence Dashboard and AI Whisper receive the demo picks directly

**4. Update: `src/components/scout/CustomerConfidenceDashboard.tsx`**
- No changes needed -- it already accepts picks as props

**5. Update: `src/components/scout/CustomerAIWhisper.tsx`**
- No changes needed -- it already accepts picks and signals as props

### Demo Data Examples

| Player | Prop | Line | Current | Side |
|---|---|---|---|---|
| LeBron James | points | 24.5 | 18 | over |
| Jayson Tatum | rebounds | 8.5 | 5 | over |
| Anthony Davis | blocks | 2.5 | 1 | over |
| Jrue Holiday | assists | 5.5 | 7 | over |
| Austin Reaves | points | 16.5 | 19 | under |

### Technical Details

- Demo mode is purely client-side -- no database queries, no edge function calls
- The Sweet Spot Props and Hedge Panel will show their normal "no data" empty states (since there's no real DB data), which is fine -- the demo picks populate the Confidence Dashboard and Whisper
- Demo banner uses a subtle `bg-primary/10` strip with a pulsing indicator so it's noticeable but not intrusive
- No new dependencies needed

### Files Changed

| File | Action |
|---|---|
| `src/data/demoScoutData.ts` | Create -- demo game context + sample picks |
| `src/pages/Scout.tsx` | Update -- render demo CustomerScoutView when no game live |
| `src/components/scout/CustomerScoutView.tsx` | Update -- accept isDemo prop, show banner, use demo data |


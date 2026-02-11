
# Make "+28 more" Expandable to Show All Parlays

## Current Behavior
On the Bot Dashboard, only the first 10 parlays are shown, with a static "+X more" text label for the rest. Users can't see the hidden parlays.

## Change

**File**: `src/pages/BotDashboard.tsx` (lines 180-189)

Replace the static "+X more" text with a collapsible expand/collapse button:

1. Add a `showAllParlays` state variable (`useState(false)`)
2. Change `.slice(0, 10)` to conditionally show all or first 10 based on state
3. Replace the static `<p>` with a clickable button that toggles expansion:
   - Collapsed: "+28 more" with a ChevronDown icon
   - Expanded: "Show less" with a ChevronUp icon

### Technical Detail

```typescript
const [showAllParlays, setShowAllParlays] = useState(false);

// In render:
{(showAllParlays ? state.todayParlays : state.todayParlays.slice(0, 10)).map((parlay) => (
  <BotParlayCard key={parlay.id} parlay={parlay} />
))}
{state.todayParlays.length > 10 && (
  <Button
    variant="ghost"
    size="sm"
    className="w-full text-muted-foreground"
    onClick={() => setShowAllParlays(!showAllParlays)}
  >
    {showAllParlays ? (
      <>Show less <ChevronUp className="ml-1 h-4 w-4" /></>
    ) : (
      <>+{state.todayParlays.length - 10} more <ChevronDown className="ml-1 h-4 w-4" /></>
    )}
  </Button>
)}
```

Imports needed: `ChevronDown`, `ChevronUp` from lucide-react (check if already imported), and `useState` (already imported).

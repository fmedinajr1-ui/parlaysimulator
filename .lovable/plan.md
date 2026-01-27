

# Add Disclaimer Section to Whale Proxy Dashboard

## Overview

Add an informational disclaimer section that clearly communicates to users that the signals shown represent **market movement patterns** inferred from line analysis, not confirmed "whale" bets or insider information.

## Implementation Approach

### Option Selected: Collapsible Info Card

I'll add a collapsible info card at the top of the dashboard (below the header, above filters) that:
- Shows a brief disclaimer by default
- Expands to show more detailed explanation of how signals work
- Can be dismissed but reappears on page refresh

This approach is better than a simple tooltip because:
1. More visible - users will see it immediately
2. More space for educational content about signal types
3. Matches the existing card-based UI pattern

---

## Files to Create/Modify

### 1. Create New Component: `src/components/whale/WhaleDisclaimer.tsx`

A collapsible card component with:
- Info icon + brief disclaimer text
- "Learn more" expand/collapse toggle
- Detailed explanation of each signal type when expanded
- Visual styling consistent with existing cards (using `Card`, `Badge` components)

**Content to display:**

**Collapsed (default):**
> These signals show market movement patterns, not confirmed bets. Tap to learn more.

**Expanded:**
> **What are these signals?**
> 
> This dashboard detects where professional bettors ("sharps") may be moving lines by analyzing:
>
> - **DIVERGENCE** - PrizePicks line differs significantly from book consensus
> - **STEAM** - Rapid line movement detected across multiple sportsbooks  
> - **BOOK_DIVERGENCE** - Major books (FanDuel, DraftKings) disagree on the line
>
> **Important:** These are statistical patterns, not confirmed whale bets. Sharp money is inferred from line movements, not tracked directly. Use signals as one data point in your research, not as guaranteed picks.

### 2. Update: `src/components/whale/WhaleProxyDashboard.tsx`

- Import the new `WhaleDisclaimer` component
- Add it between the header and filters sections (around line 44)

---

## Component Structure

```
WhaleDisclaimer
├── Card (bg-blue-500/10, border-blue-500/20)
│   ├── Header Row
│   │   ├── Info Icon
│   │   ├── Disclaimer text (brief)
│   │   └── ChevronDown/Up toggle button
│   │
│   └── Collapsible Content (expanded state)
│       ├── "What are these signals?" heading
│       ├── Signal type explanations with badges
│       └── "Important" disclaimer paragraph
```

---

## Technical Details

### Dependencies Used (all already installed):
- `lucide-react` for icons (`Info`, `ChevronDown`, `ChevronUp`)
- `@/components/ui/card` for Card, CardContent
- `@/components/ui/badge` for signal type badges
- `@/components/ui/collapsible` for expand/collapse functionality
- `framer-motion` (optional) for smooth animations

### State Management:
- Local `useState` for expanded/collapsed state
- No persistence needed (disclaimer shows on each visit)

---

## Visual Design

The disclaimer will use a blue/info color scheme to differentiate it from the green (live picks) and amber (watchlist) sections:

- Background: `bg-blue-500/10`
- Border: `border-blue-500/20`
- Icon: `text-blue-400`
- Signal badges: Match existing colors (orange for DIVERGENCE, blue for STEAM)

---

## Expected Result

Users will see a clear, non-intrusive info card explaining:
1. What the signals mean
2. How they're generated (market pattern detection)
3. That these are NOT confirmed whale bets
4. Recommendation to use as research data, not guaranteed picks

This sets proper expectations and adds transparency to the feature.


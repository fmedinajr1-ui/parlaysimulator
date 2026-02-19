

## Add Customer-Facing Simplified Hedge Indicator

### Overview

Replace the detailed admin `HedgeRecommendation` component (834 lines of rotation analysis, zone matchups, hedge sizing, etc.) with a clean, simplified indicator for the customer view. Customers see only three statuses: **ON TRACK**, **CAUTION**, and **ACTION NEEDED** -- no dollar amounts, no "BET UNDER X NOW" instructions, no internal analytics.

### Status Mapping

The 5-tier admin system maps to 3 customer-friendly tiers:

```text
Admin Status         Customer Status      Customer Label
────────────────     ──────────────────   ──────────────
on_track             on_track             ON TRACK
profit_lock          on_track             ON TRACK
monitor              caution              CAUTION
alert                action_needed        ACTION NEEDED
urgent               action_needed        ACTION NEEDED
```

### Changes

**1. New component: `src/components/scout/CustomerHedgeIndicator.tsx`**
- Simple component that accepts a `DeepSweetSpot` and renders one of three badges
- Uses the shared `calculateHedgeStatus()` from `hedgeStatusUtils.ts` (same logic as admin, just simplified display)
- Shows a short, non-technical message:
  - ON TRACK: "Looking good" + a progress indicator (e.g., "12 of 24.5")
  - CAUTION: "Keep watching" + current vs line
  - ACTION NEEDED: "At risk" + current vs line
- No dollar amounts, no "BET X", no hedge sizing, no rotation tiers

**2. New component: `src/components/scout/CustomerHedgePanel.tsx`**
- Replaces `ScoutHedgePanel` in the customer view
- Same data source (useDeepSweetSpots + useSweetSpotLiveData) but uses `CustomerHedgeIndicator` instead of `HedgeRecommendation`
- Header says "Pick Status" instead of "Hedge Recommendations"
- Summary badges show counts of ON TRACK / CAUTION / ACTION NEEDED

**3. Update `src/components/scout/CustomerScoutView.tsx`**
- Replace `ScoutHedgePanel` with `CustomerHedgePanel`
- Admin view (`Scout.tsx` without `isCustomer`) keeps the existing detailed `ScoutHedgePanel`

### Technical Details

**CustomerHedgeIndicator.tsx**
```tsx
// Maps hedge status -> simplified customer tier
type CustomerTier = 'on_track' | 'caution' | 'action_needed';

function mapToCustomerTier(status: HedgeStatus): CustomerTier {
  if (status === 'on_track' || status === 'profit_lock') return 'on_track';
  if (status === 'monitor') return 'caution';
  return 'action_needed'; // alert, urgent
}

// Renders a single-line badge with icon + label + "Current X of Line"
// No hedge sizing, no "BET UNDER X", no dollar amounts
```

**CustomerHedgePanel.tsx**
```tsx
// Same data flow as ScoutHedgePanel but:
// - Title: "Pick Status" (not "Hedge Recommendations")
// - Uses CustomerHedgeIndicator (not HedgeRecommendation)
// - Summary badges: ON TRACK / CAUTION / ACTION NEEDED counts
// - No internal analytics exposed
```

**CustomerScoutView.tsx**
```tsx
// Line 37: Replace ScoutHedgePanel with CustomerHedgePanel
import { CustomerHedgePanel } from './CustomerHedgePanel';
// ...
<CustomerHedgePanel homeTeam={homeTeam} awayTeam={awayTeam} />
```

### What Customers See

Each pick card shows:
- Player name + prop type badge (e.g., "PTS")
- Side + line (e.g., "OVER 24.5")
- A single status badge: green "ON TRACK", yellow "CAUTION", or red "ACTION NEEDED"
- A short neutral message like "12 of 24.5 -- on pace" (no betting instructions)

### What Customers Do NOT See

- Dollar hedge sizing ("$50-100")
- "BET UNDER X NOW" instructions
- Rotation tier analysis
- Zone matchup charts
- Quarter sparklines
- Pace momentum trackers
- Hit probability percentages
- Rate per minute calculations
- Risk flag details (blowout, foul trouble)


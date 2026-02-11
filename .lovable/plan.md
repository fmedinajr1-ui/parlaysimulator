

# Bot Dashboard UI Overhaul + Calendar Enhancement

## Overview
Complete redesign of the Bot Dashboard page with a modern, polished layout and an upgraded P&L Calendar. The goal is a cleaner visual hierarchy, better information density, and a more professional look.

## Changes

### 1. P&L Calendar Upgrade (`BotPnLCalendar.tsx`)
- Add tooltip/popover on day cells showing detailed breakdown (parlays won/lost, bankroll)
- Animate the day cells with subtle fade-in on month change
- Add a heatmap intensity scale (darker green/red for larger P&L amounts)
- Show a mini sparkline of daily P&L below the calendar grid
- Improve the stats row with proper card-style containers and icons

### 2. Bot Dashboard Layout Overhaul (`BotDashboard.tsx`)
- **Hero Section**: Merge the header + activation card into a single hero banner with a gradient background, showing mode (Sim/Real), bankroll, and streak in a compact top bar
- **Tabbed Layout**: Organize the 10+ cards into 3 tabs:
  - **Overview**: Activation progress, P&L Calendar, Performance Chart, Action Buttons
  - **Parlays**: Today's parlays with tier breakdown, parlay cards
  - **Analytics**: Learning Analytics, Category Weights, Learning Log, Activity Feed
- **Quick Actions Bar**: Sticky bottom bar with Generate + Settle buttons (replace the mid-page grid)
- **Notification Settings**: Move to a settings icon/popover instead of a full card

### 3. Component Visual Upgrades
- **BotActivationCard**: Reduce to a compact horizontal strip at top instead of a full card. Show progress ring inline with key stats
- **BotPerformanceChart**: Add toggle between Bankroll and Daily P&L views
- **BotParlayCard**: Add color-coded left border by tier (blue/amber/green), compact the metrics into a single row
- **CategoryWeightsChart**: Add a mini bar chart visualization instead of just progress bars
- **TierBreakdownCard**: Show as a horizontal segmented bar (exploration | validation | execution) with proportional widths
- **BotActivityFeed**: Compact timeline style with dot indicators instead of full icon blocks

### 4. New Components
- **BotQuickStats**: A horizontal stat strip showing key numbers (Total P&L, Win Rate, Streak, ROI) always visible at top
- **BotTabNavigation**: Tab component for organizing the dashboard sections

## Technical Details

### Files Modified
- `src/pages/BotDashboard.tsx` -- Complete layout restructure with tabs
- `src/components/bot/BotPnLCalendar.tsx` -- Heatmap intensity, day tooltips, sparkline
- `src/components/bot/BotActivationCard.tsx` -- Compact horizontal layout
- `src/components/bot/BotPerformanceChart.tsx` -- Dual view toggle (bankroll/daily)
- `src/components/bot/BotParlayCard.tsx` -- Tier color borders, compact metrics
- `src/components/bot/BotActivityFeed.tsx` -- Timeline dot style
- `src/components/bot/TierBreakdownCard.tsx` -- Horizontal segmented bar

### Files Created
- `src/components/bot/BotQuickStats.tsx` -- Top stat strip
- `src/components/bot/BotTabNavigation.tsx` -- Tab wrapper

### Dependencies Used
- Existing: `@radix-ui/react-tabs`, `recharts`, `framer-motion`, `@radix-ui/react-tooltip`
- No new dependencies needed

### Architecture
The dashboard will use Radix Tabs to organize content into 3 sections. The quick stats bar and action buttons will remain outside the tabs for persistent visibility. All existing data hooks (`useBotEngine`, `useBotPnLCalendar`) remain unchanged -- this is purely a UI/layout update.


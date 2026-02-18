
## Add Stake Size to Each Parlay Card

### What's Happening Now

The `BotParlayCard` already receives `parlay.simulated_stake` from the database. It's displayed as a small muted number in the header row: `$25` in grey, sandwiched between edge % and profit/loss text. It's easy to miss and doesn't communicate "this is what you should bet."

**Current layout (compressed, hard to read):**
```
[Pending] 3L · Feb 18 2:44 PM  +27.3%  $50  → (nothing yet)
```

### What's in the Database

Today's stakes from `bot_stake_config`:
- **Execution** tier → **$300** per parlay
- **Validation** tier → **$150** per parlay
- **Exploration** tier → **$50** per parlay
- **Bankroll Doubler** → **$25** per parlay (round robin)
- Mini-parlays → **$50** (validation mini), **$25** (exploration mini), **$20** (exploration 3-leg)

### The Fix: Make Stake Prominent on Every Card

**File: `src/components/bot/BotParlayCard.tsx`**

Three visual changes:

**1. Prominent stake badge in the card header**

Replace the current muted `$50` span with a styled, clearly labeled "Bet" badge using a `DollarSign` icon so it reads as an action item rather than metadata:

```tsx
// BEFORE (line 99):
<span className="text-muted-foreground">${parlay.simulated_stake || 10}</span>

// AFTER:
<span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/15 text-primary text-xs font-bold border border-primary/30">
  <DollarSign className="w-3 h-3" />
  {parlay.simulated_stake || 10}
</span>
```

**2. Stake + potential payout summary row in the expanded detail section**

When the card is expanded, show a dedicated "Stake Plan" row that shows:
- **Bet**: `$50`
- **To Win**: `$400` (calculated from `simulated_payout`)
- **Kelly Tier**: `Exploration` (derived from `tier` field)

This goes just above the legs list in the `CollapsibleContent`:

```tsx
<div className="flex items-center justify-between py-2 px-2.5 rounded bg-primary/10 border border-primary/20 text-xs mb-2">
  <div className="flex items-center gap-1.5 text-primary font-semibold">
    <DollarSign className="w-3.5 h-3.5" />
    <span>Bet ${parlay.simulated_stake || 10}</span>
  </div>
  <div className="flex items-center gap-3 text-muted-foreground">
    <span>To win <span className="text-green-400 font-semibold">${(parlay.simulated_payout || 0).toFixed(0)}</span></span>
    <span className="capitalize">{parlay.tier || 'explore'} tier</span>
  </div>
</div>
```

**3. Add `tier` to the `BotParlay` type**

The `BotParlay` interface in `useBotEngine.ts` doesn't currently include `tier`. The database has it. Add it:

```ts
// In BotParlay interface (line ~50):
tier?: string;
```

This lets the card display `Execution`, `Validation`, or `Exploration` next to the stake so the user immediately knows the confidence level behind the bet size.

---

### Visual Result

**Collapsed card** — stake appears as a green-tinted pill badge that stands out:
```
[Pending] 3L · Feb 18  +27.3%  [$50]  → (pending)
```

**Expanded card** — a dedicated "Stake Plan" bar shows before the legs:
```
┌─────────────────────────────────────────────┐
│  $ Bet $50              To win $387   Explore│
├─────────────────────────────────────────────┤
│  LeBron James  Points OVER 25.5     -115    │
│  ...                                        │
└─────────────────────────────────────────────┘
```

---

### Files Changed

**1. `src/hooks/useBotEngine.ts`** — Add `tier?: string` to `BotParlay` interface (1 line)

**2. `src/components/bot/BotParlayCard.tsx`** — Two UI changes:
   - Replace muted stake span in the header with a styled pill badge
   - Add stake/payout summary row inside the expanded collapsible content

No database changes, no new dependencies, no new components needed.

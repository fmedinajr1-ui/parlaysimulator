
# Enable MID_SCORER_UNDER for Contrarian Fade Strategy

## The Problem

The `MID_SCORER_UNDER` category is currently **disabled** in `category-props-analyzer/index.ts`:

```typescript
MID_SCORER_UNDER: {
  name: 'Mid Scorer Under',
  propType: 'points',
  avgRange: { min: 12, max: 22 },
  lines: [14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5],
  side: 'under',
  minHitRate: 0.55,
  // v7.0: DISABLED - 45% hit rate
  disabled: true  // ← This blocks picks from being generated
},
```

Because this category is disabled, **no picks are generated** for the contrarian fade system to flip.

## The Solution

### Option A: Re-enable for Fade-Only Use (Recommended)

Enable the category but add metadata indicating it's meant for contrarian use:

| File | Change |
|------|--------|
| `category-props-analyzer/index.ts` | Remove `disabled: true`, add `fadeOnly: true` |
| `useContrarianParlayBuilder.ts` | Already configured to flip MID_SCORER_UNDER |

### Option B: Create New Category

Create a separate `MID_SCORER_FADE` category that generates OVER picks directly.

## Implementation Details

### 1. Update Category Config (Edge Function)

```typescript
MID_SCORER_UNDER: {
  name: 'Mid Scorer Under',
  propType: 'points',
  avgRange: { min: 12, max: 22 },
  lines: [14.5, 15.5, 16.5, 17.5, 18.5, 19.5, 20.5],
  side: 'under',
  minHitRate: 0.55,
  // v8.0: RE-ENABLED for contrarian fade strategy (55% OVER hit rate)
  fadeOnly: true  // Indicate this category is for fading, not direct plays
},
```

### 2. Update Contrarian Hook

The hook already has MID_SCORER_UNDER configured:

```typescript
{ category: 'MID_SCORER_UNDER', originalSide: 'under', hitRate: 45, fadeHitRate: 55, record: '9-11' }
```

Once picks are generated, they'll automatically appear in the "Fades" tab with OVER recommendations.

### 3. Run Cascade to Generate Picks

After deployment, the SlateRefreshControls "Refresh All Engines" button will:
1. Run `category-props-analyzer` → generates MID_SCORER_UNDER picks
2. The Contrarian Fade Card → displays them flipped to OVER
3. Build Fade Parlay → includes them with 55% confidence

## Files to Modify

| File | Action |
|------|--------|
| `supabase/functions/category-props-analyzer/index.ts` | Re-enable MID_SCORER_UNDER category |

## Expected Outcome

After running the category analyzer:
- Players averaging 12-22 PPG will be identified
- They'll be stored with `recommended_side: 'under'`
- The Contrarian Fade tab will flip them to OVER
- Smart Fades will filter to only those where L10 avg > current line

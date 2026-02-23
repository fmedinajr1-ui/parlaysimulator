

## Remove MispricedLinesCard and HighConvictionCard from Homepage

Move these two analysis cards off the homepage so they only appear on the dashboard.

### Changes

**File: `src/pages/Index.tsx`**
- Remove the `MispricedLinesCard` import and its rendered block (lines ~12, 170-173)
- Remove the `HighConvictionCard` import and its rendered block (lines ~13, 175-178)

No other files need to change. Both cards and their hooks remain intact for use on the dashboard.


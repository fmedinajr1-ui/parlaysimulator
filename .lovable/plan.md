

## Fix: Bypass Paywall for Test Customer Mode

### Problem
When visiting `/scout?test_customer=true`, the `subLoading` check and/or `hasAccess` check still blocks the page -- showing the paywall instead of the customer view.

### Solution
A single change in `src/pages/Scout.tsx`: when `testCustomer` is true, skip the loading spinner and the paywall gate entirely.

### Changes

**File: `src/pages/Scout.tsx`**

1. Update the loading gate (line 241) to also allow `testCustomer` through:
```
if (subLoading && !testCustomer) {
```

2. The `hasAccess` gate already includes `testCustomer`, so no change needed there -- but if `subLoading` never resolves (e.g. user not logged in), this fix ensures the page still renders.

This is a one-line change. After this, navigating to `/scout?test_customer=true` will immediately show the customer dashboard with the stream panel, sweet spot props, and hedge recommendations -- no login or subscription required.


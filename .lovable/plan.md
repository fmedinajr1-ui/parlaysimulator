

## Test Customer Scout View with Query Parameter Override

### Goal
Add a simple `?test_customer=true` query parameter to the Scout page URL so you (as an admin) can preview exactly what customers see -- without changing your subscription or role.

### How It Works
A single line change in `src/pages/Scout.tsx` will check for the URL parameter and override the `isCustomer` flag:

```
const isCustomer = (hasScoutAccess && !isAdmin) || searchParams.get('test_customer') === 'true';
```

### To Test
After the change, navigate to:

**`/scout?test_customer=true`**

You'll see the customer view with:
- Stream panel (placeholder)
- Sweet Spot Props (from today's `category_sweet_spots` data)
- Hedge Recommendations (live enriched data)

Remove `?test_customer=true` from the URL to go back to admin view.

### Technical Details

**File:** `src/pages/Scout.tsx`
- Import `useSearchParams` from `react-router-dom`
- Add `const [searchParams] = useSearchParams();`
- Update `isCustomer` to include the query param override
- No other files change; this is a dev/test convenience only


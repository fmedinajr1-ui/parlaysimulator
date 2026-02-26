

## Secure Internal Pipeline Data from Customers

### Problem
While the Dashboard UI is admin-gated (redirects non-admins), there are two gaps:

1. **Database-level exposure**: The `bot_activity_log` table has a fully public SELECT RLS policy (`USING (true)`). Any authenticated customer can query the API directly and see settlement reports, pipeline doctor diagnostics, hit rate evaluations, calibration data, and internal operational metadata.

2. **Navigation leak**: The "Dashboard" link appears in the mobile menu for ALL users (not just admins). Non-admins get redirected, but they shouldn't see the link at all.

### Changes

#### 1. Restrict `bot_activity_log` RLS to admins only
Replace the current open SELECT policy with one that uses the `has_role` function:

```sql
DROP POLICY "Anyone can view bot activity log" ON bot_activity_log;

CREATE POLICY "Only admins can view bot activity log"
ON bot_activity_log FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
```

This ensures customers cannot query pipeline internals even via direct API calls.

#### 2. Move "Dashboard" to admin-only section in mobile navigation
In `src/components/layout/MobileFloatingMenu.tsx`, move the Dashboard menu item from `menuItems` (visible to all) into `adminItems` (visible only when `showAdmin` is true).

### Technical Details

**File: `src/components/layout/MobileFloatingMenu.tsx`**
- Remove `{ icon: LayoutDashboard, label: "Dashboard", path: "/dashboard" }` from `menuItems`
- Add it to `adminItems`

**Database Migration:**
- Drop the existing open SELECT policy on `bot_activity_log`
- Create a new admin-only SELECT policy using `public.has_role(auth.uid(), 'admin')`

### What customers will see after this
- No "Dashboard" link in their navigation
- No access to `bot_activity_log` data via API
- No visibility into settlement reports, hit rate targets, pipeline doctor diagnostics, or calibration weights
- Their existing customer-facing features (parlay cards on landing page, Telegram bot commands) remain unaffected


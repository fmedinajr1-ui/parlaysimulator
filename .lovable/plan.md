

# Protect Dashboard Route (Admin Only)

## Summary

Wrap the `/dashboard` route with an admin check so only your account can access it. Non-admin users (or unauthenticated visitors) get redirected to `/`.

## Changes

### 1. `src/pages/BotDashboard.tsx`

Add the existing `useAdminRole` hook at the top of the component:
- If `isLoading`, show the existing skeleton/loading state
- If `!isAdmin`, render `<Navigate to="/" replace />`
- Otherwise, render the dashboard as normal

This reuses the same `useAdminRole` hook already used by the Admin page, which checks the `user_roles` table for an `admin` role.

### 2. No other changes needed

The `useAdminRole` hook and `user_roles` table are already in place. Your account already has the admin role. No new tables, RLS policies, or edge functions required.

## Technical Details

At the top of `BotDashboard`:

```tsx
import { useAdminRole } from '@/hooks/useAdminRole';
import { Navigate } from 'react-router-dom';

export default function BotDashboard() {
  const { isAdmin, isLoading: adminLoading } = useAdminRole();
  // ... existing hooks ...

  if (adminLoading || state.isLoading) {
    return /* existing skeleton */;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  // ... rest of dashboard
}
```

## Files Modified
- `src/pages/BotDashboard.tsx` -- Add admin gate using existing `useAdminRole` hook


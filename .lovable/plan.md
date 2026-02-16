

# Hidden Admin Login Route

## Summary

Create a hidden `/admin-login` page so you can sign in and access the protected `/dashboard`. No public links will point to this route — you access it by typing the URL directly.

## What's Already Working

- `/dashboard` is admin-gated via `useAdminRole()` — non-admins get redirected to `/`
- Your account has the `admin` role in `user_roles`
- `useAuth().signIn()` handles email/password login
- The only missing piece is a login UI

## Changes

### 1. New File: `src/pages/AdminLogin.tsx`

A minimal, unbranded login form:
- Email + password fields only (no signup, no branding)
- Calls `useAuth().signIn(email, password)`
- On success, navigates to `/dashboard`
- If already logged in, auto-redirects to `/dashboard`
- Simple dark card design matching existing theme

### 2. Update: `src/App.tsx`

- Add lazy import: `const AdminLogin = React.lazy(() => import("./pages/AdminLogin"))`
- Add route: `<Route path="/admin-login" element={<AdminLogin />} />`
- No links to this route from any UI

## Files

| File | Action |
|------|--------|
| `src/pages/AdminLogin.tsx` | Create |
| `src/App.tsx` | Add route |


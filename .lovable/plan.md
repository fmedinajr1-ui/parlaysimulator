# Fix: clients can't reach Stripe checkout from signup modal

## Root cause

`src/components/farm/EmailCaptureModal.tsx` opens the Stripe checkout URL with:

```ts
if (data?.url) {
  window.open(data.url, "_blank");
  onClose();
}
```

This call happens **after** `await supabase.functions.invoke(...)`. Safari, Chrome iOS, and most popup blockers reject `window.open` that isn't tied to a synchronous user gesture, so:

1. No new tab opens.
2. `onClose()` fires anyway.
3. The user is left on the page they came from (the landing / "dashboard") with no feedback.

That matches the client's report ("when they enter email it goes back to dashboard, it doesn't go to checkout"). The bug hits **both** tiers (Pup and All-Access) because they share this modal.

Every other checkout entry point in the app (`useSubscription.startBotCheckout`, `useSubscription.startCheckout`, `purchase-scans` callers) uses `window.location.href = data.url`, which is not blocked.

## Change

Primary file: `src/components/farm/EmailCaptureModal.tsx`

- Replace `window.open(data.url, "_blank"); onClose();` with `window.location.href = data.url;` (do not call `onClose()` — the navigation replaces the page).
- Keep the loading state on so the button stays disabled while the redirect kicks in.
- Leave error handling and toast behavior unchanged.

Follow-up hardening: dashboard/inline checkout paths also had async `window.open(data.url, "_blank")` calls, so `src/pages/Index.tsx` and `src/components/home/HomepageAnalyzer.tsx` now use same-tab redirects too.

Safari mobile bounce-back fix: checkout redirects now clear the saved mobile route and set a checkout-in-progress flag before leaving the app. `useRoutePersistence` and `usePageLifecycle` respect that flag so iOS does not save/restore `/dashboard` while Stripe is opening or returning.

No backend, edge function, Stripe, or DB changes needed — the checkout functions are already returning a valid `url`.

## Verification

1. Open landing page in an incognito window on desktop Chrome → click All-Access → enter email → confirm the tab redirects to `checkout.stripe.com`.
2. Repeat on mobile Safari (the original failure surface).
3. Repeat for the Free Pup tier → should redirect to the $50 card-verification Stripe page.
4. Cancel from Stripe → confirm `cancel_url` returns to `/` cleanly.

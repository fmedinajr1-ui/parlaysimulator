
Implement a shared persisted Sweet Spots funnel preference so Core vs Aggressive becomes one source of truth across the page, the builder, refreshes, return visits, and Telegram-facing outputs.

### What will change

#### 1. Create one persisted funnel preference instead of separate page-local state
Right now the Sweet Spots page and the Sweet Spot builder each manage their own `funnelMode` in component state. I’ll replace that with a shared preference layer so both surfaces read/write the same value:
- Sweet Spots main page toggle
- Sweet Spot builder packs toggle
- any downstream consumer that needs to know whether the user is in Core or Aggressive mode

That means switching the mode once updates the full Sweet Spots experience immediately.

#### 2. Persist the last selected mode across refreshes and return visits
I’ll store the user’s last funnel choice so it survives:
- hard refresh
- closing and reopening the app
- navigating away and coming back to `/sweet-spots`

Persistence behavior:
- signed-in users: save to backend per user
- signed-out users: fallback to browser storage so refresh still works locally

This avoids losing the setting and keeps the experience sticky.

#### 3. Add a small shared hook/provider for Sweet Spots preferences
I’ll introduce a dedicated preference abstraction for Sweet Spots UI state, likely something like:
- `useSweetSpotPreferences()`
- or a small shared context/hook for `funnelMode`

Responsibilities:
- load persisted value on mount
- expose `funnelMode`
- expose `setFunnelMode`
- handle optimistic updates
- keep page and builder in sync
- fallback cleanly if backend is unavailable

#### 4. Back the preference with proper persistent storage
To make this durable for authenticated users, I’ll add a backend table for user-level UI preferences or extend an existing preference store if that fits cleanly.

The stored data will include at minimum:
- `user_id`
- `sweet_spots_funnel_mode`
- timestamps

I’ll also add RLS so users can only read/write their own preference row.

#### 5. Wire the Sweet Spots page to the shared preference
`src/pages/SweetSpots.tsx` currently owns a local `useState<'core' | 'aggressive'>`. I’ll refactor it to:
- read the mode from the shared persistence hook
- use loading-safe defaults while the preference resolves
- keep the existing filtering behavior, but based on the shared stored mode

This will make the Sweet Spots card list restore the last-used funnel automatically.

#### 6. Wire the parlay builder toggle to the same shared preference
`src/components/market/SweetSpotDreamTeamParlay.tsx` also has its own local funnel state. I’ll remove that duplication and point it to the same source of truth so:
- the builder opens in the same mode the page was last using
- switching mode in the builder updates the main Sweet Spots view
- switching mode on the page updates the builder recommendation packs

#### 7. Push the new funnel truth into Telegram outputs
Since you want this directed to Telegram too, I’ll make the Telegram layer reflect the same Core/Aggressive truth instead of using disconnected defaults.

That includes two paths:

**Admin alerts**
- add funnel mode context to Sweet Spot/admin notifications where relevant
- include whether output was generated under `Core` or `Aggressive`
- ensure any new Sweet Spots-related backend function that publishes updates can call the Telegram sender

**Bot command / user-facing Telegram output**
- update the Sweet Spots-related Telegram response flow so it reports the funnel mode being used
- ensure the bot’s Sweet Spots output uses the same funnel logic as the app, not a separate hidden default
- if a user-specific preference can be resolved, use that
- otherwise fall back to a clear default and state it in the response

#### 8. Make new Sweet Spots-related backend functions Telegram-aware
For any new backend function needed for this feature, I’ll wire Telegram notification support intentionally rather than leaving it disconnected:
- emit admin Telegram summaries where a mode change or Sweet Spots refresh matters
- reuse the existing Telegram sender pattern
- avoid noisy spam by limiting alerts to meaningful state changes / refresh results

#### 9. Preserve clean UX around loading and failures
I’ll make sure the toggle behavior is resilient:
- instant UI update on switch
- background persistence save
- rollback or toast if save fails
- fallback to local storage if the user is not signed in
- no blank/empty state while the preference is loading

### Files likely involved

- `src/pages/SweetSpots.tsx`
  - replace local funnel state with shared persisted preference
- `src/components/market/SweetSpotDreamTeamParlay.tsx`
  - remove duplicate local toggle state and consume shared mode
- new shared hook/context, likely something like:
  - `src/hooks/useSweetSpotPreferences.ts`
  - or a small context/provider if needed
- backend migration:
  - new preferences table or extension of an existing preferences table
- Telegram-related backend function(s)
  - update Sweet Spots/admin notification flow to include funnel mode
  - update bot-facing Sweet Spots output to use the shared mode truth

### Technical details

#### Proposed persistence model
Preferred approach:
```text
Authenticated user
→ load Sweet Spots preference from backend
→ sync changes back to backend

Guest user
→ load Sweet Spots preference from localStorage
→ persist locally on change
```

#### Proposed stored value
```text
sweet_spots_funnel_mode = 'core' | 'aggressive'
```

#### Hard requirement for shared truth
Both of these should read the same value:
```text
SweetSpots page filter funnel
SweetSpotDreamTeamParlay builder funnel
Telegram Sweet Spots mode labeling/output
```

#### Security
If a backend table is added:
- RLS enabled
- users can only read/write their own row
- no roles on profiles/users
- user identity resolved through authenticated session

### Verification

1. Switch to Aggressive on Sweet Spots page, refresh, and it stays Aggressive.
2. Navigate away and back to Sweet Spots, the same mode is restored.
3. Switch mode in the builder, and the main Sweet Spots page reflects the same mode.
4. Switch mode on the page, and builder packs update to the same mode.
5. Signed-in users keep their preference across sessions/devices via backend storage.
6. Signed-out users still keep it across refreshes locally.
7. Sweet Spots-related Telegram outputs show whether they are Core or Aggressive.
8. Any new backend function added for this flow is wired into the Telegram bot notification path where appropriate.
9. No empty-gate regression: stored mode restores cleanly without flashing wrong results.

### Expected outcome

After this change:
- your last Core/Aggressive selection will stick when you refresh or come back
- Sweet Spots page and builder will stop drifting apart
- Telegram outputs will reflect the same funnel mode truth
- new Sweet Spots-related backend behavior will be Telegram-aware instead of silently living only in the UI

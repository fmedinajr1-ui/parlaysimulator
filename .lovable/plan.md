

# Fix: Make Alt Lines Active and Working

## Issues Found

1. **`fetch-batch-odds` missing from `config.toml`** — The edge function exists (`supabase/functions/fetch-batch-odds/index.ts`) but has no entry in `supabase/config.toml`. This means it is not deployed, so `useLiveSweetSpotLines` fails silently when calling it. This is the root cause — no live book lines are ever fetched, so the Alt Line column in the Hedge Monitor always shows "—".

2. **`fetch-batch-odds` uses deprecated `serve` import** — It imports from `https://deno.land/std@0.168.0/http/server.ts` instead of using `Deno.serve()`. This can cause deployment failures.

3. **Fallback masks failure** — In `WarRoomLayout.tsx`, `liveBookLine` falls back to `s.line` (the original line) when live data is missing. So the alt line column shows "—" instead of indicating an error — the system looks like it's working but just has no movement, when in reality it never fetched data.

## Plan

### 1. Add `fetch-batch-odds` to `config.toml`
Add the missing entry:
```toml
[functions.fetch-batch-odds]
verify_jwt = false
```

### 2. Fix deprecated import in `fetch-batch-odds/index.ts`
Replace `import { serve } from "https://deno.land/std@0.168.0/http/server.ts"` and `serve(async (req) => {` with `Deno.serve(async (req) => {` to match the pattern used by all other edge functions.

### 3. Add console logging for debugging
Add a visible log in `useLiveSweetSpotLines.ts` when the batch fetch returns zero results or errors, so failures are not silently swallowed.

### 4. Deploy and verify
After changes, deploy `fetch-batch-odds` and test it with a sample request to confirm it returns live lines.

These are all small, targeted fixes — no logic changes. Once deployed, the existing Alt Line column, Smart Line badges, and live line tracking will all start receiving real data.


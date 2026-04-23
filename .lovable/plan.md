

## Goal
Add a new **OCR Prop Scanner** with three capture modes (screen recording, screenshot burst, live camera), full deep cross-reference (DNA + sweet-spot + correlation), both auto-parlays AND a manual builder — accessible from the **web app** AND **Telegram** so you can scan props from your phone while inside the sportsbook app.

## What gets built

### 1. New web route: `/scan` — Prop Scanner

Single page, three capture-mode tabs, live session pool, dual output panel.

```text
┌───────────────────────────────────────────────────────────────┐
│ Prop Scanner — Session: NBA · 2026-04-23 · FanDuel            │
├───────────────────────────────────────────────────────────────┤
│ [📹 Record]  [📸 Screenshots]  [🎥 Camera]   Book: [FD▼]      │
├───────────────────────────────────────────────────────────────┤
│ Capture surface (active mode renders here)                    │
├───────────────────────────────────────────────────────────────┤
│ Session Pool (live, deduped, scored, multi-select)            │
│   ☑ LeBron · Points Over 27.5 (-115)       DNA:87 🟢          │
│   ☑ Tatum · Threes Over 3.5 (+105)         DNA:74 🟡          │
│   ☐ Brunson · Assists Under 6.5 (-110)     DNA:42 🔴          │
│     ↳ blocked: low L10 hit rate, opp def #28                  │
├───────────────────────────────────────────────────────────────┤
│ [⚡ Auto-Parlays]    [🛠 Manual Builder]                       │
└───────────────────────────────────────────────────────────────┘
```

### 2. Capture pipeline (3 modes, user picks per session)

Reuses what already exists in the repo.

| Mode | Foundation | New work |
|------|------------|----------|
| Screen recording | `lib/video-frame-extractor.ts`, `ScoutVideoUpload` | Record sportsbook tab, sample 1 fps, perceptual-hash dedupe |
| Burst screenshots | `lib/image-compression.ts` (OCR preprocessing) | Drop-zone + paste tray, batch queue |
| Live camera | `lib/live-stream-capture.ts`, `ScoutLiveCapture` | Freeze-frame button, OCR overlay |

All three funnel into the same edge function: `ocr-prop-scan`.

### 3. New edge function: `ocr-prop-scan`

Input: `{ frames: base64[], book, sport, session_id }`.
Pipeline:
1. **Vision OCR** — Lovable AI (`google/gemini-3-flash-preview`) with structured-output tool schema → `[{player_name, prop_type, line, side, over_price, under_price, confidence, raw_text}]`. Book-aware system prompt picks the layout parser.
2. **Normalize** — canonical prop types, American odds, side mapping (PrizePicks "more"/"less" → over/under).
3. **Deep cross-reference** (parallel per prop):
   - `unified_props` match → real-line presence + price delta
   - L10 hit rate + season avg from `nba_player_game_logs` / `mlb_player_game_logs`
   - opponent defensive rank + pace
   - `category_sweet_spots` membership
   - DNA score via existing pick-DNA helpers
   - correlation gates (`mem://logic/parlay/same-game-concentration`)
4. **Persist** to `ocr_scanned_props`.
5. **Return** enriched rows.

### 4. New edge function: `ocr-pool-build-parlays`

Input: `{ session_id, selected_prop_ids?, target_legs (2–6), mode: 'auto'|'manual' }`.
- Reuses `parlay-engine-v2` scoring + correlation, scoped to the captured pool only.
- `auto`: returns 1–4 ranked tickets with leg-by-leg DNA + correlation reasoning.
- `manual`: returns live conflict feedback as the user toggles legs.
- Generated parlays stored with `source_origin: 'ocr_scan'` so they're isolated from the main slate.

### 5. Telegram integration

Telegram is **not just a notifier** here — it's a full capture surface.

**New edge function: `telegram-prop-scanner`** (called from the existing `telegram-poll` worker)

Routes the following commands and message types:

| Trigger | Behavior |
|---------|----------|
| `/scan start <sport> <book>` | Creates a new `ocr_scan_sessions` row tied to your Telegram chat ID. Replies "Session started — send screenshots." |
| Photo / image message | `getFile` → download via gateway → forward bytes to `ocr-prop-scan` → reply with parsed legs + DNA chips inline. |
| Forwarded sportsbook screenshot | Same path. Multiple photos in a media group are batched into one OCR call. |
| `/scan pool` | Returns current session pool as a numbered list with DNA scores + block reasons. |
| `/scan parlay [legs]` | Calls `ocr-pool-build-parlays` (auto mode), replies with 1–3 ranked tickets. |
| `/scan add 1 3 5` | Marks props as selected for manual builder, then `/scan parlay` builds from selection only. |
| `/scan end` | Finalizes the session. |

Authorization: Telegram chat ID is mapped to a `user_id` via the existing `telegram_authorized_accounts` table (Destiny_0711 already wired per `mem://telegram/authorized-accounts`). Unauthorized chats get a polite reject.

Replies use the standardized human-readable prop labels (`mem://telegram/ui-standardization`) and rich Markdown formatting (`mem://telegram/message-formatting`).

### 6. New tables

```sql
create table public.ocr_scan_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  telegram_chat_id bigint,                -- nullable; set when started from Telegram
  sport text not null,
  book text not null,                     -- 'fanduel'|'draftkings'|'hardrock'|'prizepicks'|'underdog'
  capture_mode text not null,             -- 'recording'|'screenshots'|'camera'|'telegram'
  status text not null default 'active',  -- 'active'|'finalized'|'archived'
  created_at timestamptz default now(),
  finalized_at timestamptz
);

create table public.ocr_scanned_props (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.ocr_scan_sessions(id) on delete cascade,
  player_name text not null,
  prop_type text not null,
  side text not null,
  line numeric not null,
  over_price int,
  under_price int,
  raw_ocr_text text,
  confidence numeric,
  matched_unified_prop_id uuid,
  market_price_delta int,
  l10_hit_rate numeric,
  l10_avg numeric,
  opp_def_rank int,
  sweet_spot_id uuid,
  dna_score int,
  composite_score int,
  correlation_tags text[],
  blocked boolean default false,
  block_reason text,
  selected_for_parlay boolean default false,
  source_origin text default 'ocr_scan',
  source_channel text default 'web',      -- 'web'|'telegram'
  created_at timestamptz default now(),
  unique (session_id, player_name, prop_type, side, line)
);
```

RLS: owner-only (`user_id = auth.uid()`), with a service-role bypass for the Telegram edge function.

### 7. New web hooks + components

- `src/hooks/useOcrScanSession.ts` — create/load session, realtime stream of new props
- `src/hooks/useOcrCapture.ts` — unified interface over the 3 modes
- `src/components/scan/CaptureModeTabs.tsx`
- `src/components/scan/ScreenRecordCapture.tsx` (`getDisplayMedia`)
- `src/components/scan/ScreenshotTray.tsx` (drop / paste / batch)
- `src/components/scan/CameraCapture.tsx`
- `src/components/scan/SessionPool.tsx` (live grid, DNA chips, block reasons, multi-select)
- `src/components/scan/AutoParlayPanel.tsx`
- `src/components/scan/ManualBuilderPanel.tsx` (extends existing `ManualParlayPanel`)
- `src/pages/PropScanner.tsx` (route `/scan`)

### 8. Book-aware OCR tuning

System prompt branches on `book`:
- **FanDuel** — over/under stacked, line above prices
- **DraftKings** — line + prices on one row
- **Hard Rock** — dense grid, bolded player name
- **PrizePicks / Underdog** — pick'em (no odds), "more"/"less" → over/under

All books normalize to one canonical schema downstream.

## Files touched

**New**
- `src/pages/PropScanner.tsx`
- `src/hooks/useOcrScanSession.ts`, `useOcrCapture.ts`
- `src/components/scan/*` (7 files)
- `supabase/functions/ocr-prop-scan/index.ts`
- `supabase/functions/ocr-pool-build-parlays/index.ts`
- `supabase/functions/telegram-prop-scanner/index.ts`
- 1 migration: tables + RLS + realtime publication on `ocr_scanned_props`

**Edited**
- `src/App.tsx` — `/scan` route
- top-nav layout — add "Scan" link
- `src/components/manual/ManualParlayPanel.tsx` — accept `sourcePool` prop
- `supabase/functions/telegram-poll/index.ts` — dispatch photo + `/scan` commands to `telegram-prop-scanner`

## Technical notes

- OCR via Lovable AI Gateway (no extra key); structured output via tool calling.
- Frame dedupe via existing perceptual hash in `video-frame-extractor`.
- Web pool updates over realtime (`postgres_changes` on `ocr_scanned_props`).
- All web capture is client-side; only base64 frames hit the function.
- Telegram photo path uses the gateway's `getFile` + `/file/{path}` flow already documented in your Telegram integration.
- Rate-limit guard on `ocr-prop-scan` (max 2 frames/sec/user) protects AI quota.
- Telegram replies surface block reasons + DNA scores inline so you can decide on the spot.

## Out of scope for v1

- Auto-grading captured props against settled outcomes (defer to existing settlement orchestrator later).
- Sharing scan sessions between users.
- Background "always on" capture.


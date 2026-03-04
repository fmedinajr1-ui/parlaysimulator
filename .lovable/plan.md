

# Add 3 More Lottery Parlays (No Voiding)

## Problem
The `nba-mega-parlay-scanner` has two blockers:
1. **Old import** — uses deprecated `serve` from `deno.land/std`, causing deployment failures (404s)
2. **Cap at ≥3** — skips generation if 3+ lottery tickets already exist today (you have 4)

## Changes

### 1. `nba-mega-parlay-scanner/index.ts` — Fix serve pattern (line 1, 165)
- Remove `import { serve } from "https://deno.land/std@0.168.0/http/server.ts";`
- Change `serve(async (req) => {` → `Deno.serve(async (req) => {`

### 2. Raise the auto-skip cap (lines 221-226)
Change `existingLotteryParlays.length >= 3` to `>= 10` so the scanner can add tickets additively without hitting the cap. The existing dedup logic (lines 227-235) already prevents duplicate player overlap.

### 3. Deploy & invoke WITHOUT force mode
Call the scanner with `{}` (no `force: true`) so existing tickets are preserved. The scanner will generate 1 Standard + 1 High Roller + 1 Mega Jackpot = 3 new tickets, deduping against existing player names.

### 4. Send slate status update
Trigger `bot-slate-status-update` to push the updated count to Telegram.




## TikTok Pipeline Integration — Phase 1 Build Plan

### What's in the zip (per README file map)

~20 TypeScript files across 5 modules (`script-gen`, `render`, `safety`, `posting`, `learning`), a Remotion React video project, SQL schema, and seed/test scripts. Mix of Node + Python.

### What we build now (Phase 1 — script gen + safety + admin UI)

No rendering, no posting, no external API keys needed yet. Output = daily script previews in Telegram + admin review UI.

---

### Step 1: Extract zip and inventory

- Copy `files_3.zip` to `/tmp`, extract, list every file with a one-line tag
- Confirm mapping before writing any project code
- Tag each file: `edge function` / `external worker` / `frontend` / `shared lib` / `defer to Phase 2+`

### Step 2: Database migration (6 tables, all admin-RLS)

```text
tiktok_accounts        — 2 rows seeded (your accounts), persona, status, warmup stage
tiktok_video_scripts   — generated scripts, hook variants, status (draft → approved → rendered → posted)
tiktok_video_renders   — render job state, asset URLs, cost log (empty until Phase 2)
tiktok_posts           — post log + view snapshots (empty until Phase 2)
tiktok_hook_performance — winning hooks fed into generator few-shot library
tiktok_pipeline_logs   — run history, errors, cost tracking
```

All tables get RLS policies gated by `has_role(auth.uid(), 'admin')`. No public access.

### Step 3: Shared types + config

Create `supabase/functions/_shared/tiktok-types.ts`:
- Port `src/shared/types.ts` (VideoScript, AvatarJob, AccountPersona, etc.)
- Port `src/shared/config.ts` (account personas, soft-angle rules, template definitions)
- Adapt DB client references to use existing Supabase client pattern

### Step 4: Edge function — `tiktok-script-generator`

Port `src/script-gen/` into a single edge function:
- `templates.ts` logic (reveal / recap / educational) inlined
- `hook-library.ts` reads from `tiktok_hook_performance` table
- `soft-angle-linter.ts` strips banned phrases, auto-rewrites
- Uses **Lovable AI Gateway** (no API key needed) instead of direct Claude calls — swap `llm-client.ts` for AI gateway call
- Pulls today's picks from `bot_daily_picks`
- Generates 3 scripts (one per template type), writes to `tiktok_video_scripts` as `draft`
- Sends preview to admin via existing `bot-send-telegram` dispatcher

### Step 5: Edge function — `tiktok-safety-gate`

Port `src/safety/` into edge function:
- `phrase-filter.ts` — banned phrase scan + auto-rewrite suggestions
- `similarity-check.ts` — content hash comparison across accounts
- `rules.ts` — the soft-angle ruleset (banned words, reframing map)
- Skip `visual-compliance.ts` for now (needs rendered video — Phase 2)
- Called by script generator before saving to DB; blocks or passes each script

### Step 6: Admin UI — `/admin/tiktok`

New page gated by `useAdminRole`, 4 tabs:

- **Queue** — today's draft scripts, approve/edit/reject inline, preview the generated text
- **Accounts** — your 2 personas, status toggles (active/warming/paused), warmup stage indicator
- **Hook Lab** — top-performing hooks table, manual hook editor, seed new hooks
- **Pipeline Health** — last run timestamp, error log, script generation stats

Reuses existing UI components (Card, Tabs, Button, Badge, Sheet). No new design system.

### Step 7: Telegram integration

- Script preview alert → admin (uses v3 format we just built)
- Safety gate block → admin alert with blocked phrase + suggested rewrite
- Reuses existing `bot-send-telegram` dispatcher with `admin_only: true`

### Step 8: Route + navigation

- Add `/admin/tiktok` route in `App.tsx` (lazy loaded)
- Add nav link in existing admin sidebar/menu

---

### What is deferred to Phase 2+

| Module | Why deferred |
|---|---|
| `src/render/` (HeyGen, ElevenLabs, Remotion) | Needs external API keys + AWS Lambda. No value until scripts are validated. |
| `src/posting/` (Blotato client, jitter) | You don't have a posting service yet. Manual download first. |
| `src/learning/view-monitor.ts` | Needs posted videos to monitor. |
| `remotion/` project | Needs separate deploy (Lambda or render server). Lives in `worker/` folder for later. |
| Python components | External worker deploy — Phase 2. |

### What I need from you

1. Approve this plan
2. Once in default mode, I'll extract the zip, inventory every file, and confirm the mapping before writing code

### Rollback

- Drop 6 tables + remove `/admin/tiktok` route. Zero impact on existing site, pipelines, or Telegram alerts.


# Project rules

- NBA research (/research): box-score math lives in `src/utils/nbaBoxScoreMath.ts` with a copy in `supabase/functions/_shared/research/math.ts`; keep both in sync, because edge functions cannot import from `src/`.
- Research data refreshes through the single daily `research-daily` job (box scores and injuries from ESPN, lines from The Odds API, then AI top plays). Add new feeds as steps there instead of new cron jobs, so AI and API usage stays at one run per day.
- Research AI calls go only through `supabase/functions/_shared/research/ai.ts`. A 402/403 response pauses the daily job (`research_job_state.paused_reason`) so it stops spending credits.
- The site root `/` is the research desk (`src/pages/Desk.tsx`, Midnight Amber theme in `src/components/desk/desk-tokens.css`); the marketing landing page lives at `/landing` (`src/pages/Home.tsx`). Keep desk styling scoped to `.desk-theme` so it never leaks into the marketing pages.
- Desk top picks come from `src/utils/nbaProjection.ts` (projection + Over/Under chosen by expected profit at posted odds); keep it pure and tested so the ranking stays explainable.
- Real bets live in `research_real_bets`, read and written only through the `desk-bets` edge function (passcode-checked, no public policies); the daily `research-daily` job grades them from box scores, and the `live` action grades legs live while My bets is open (no cron). Parlay legs share `parlay_id`; parlay math lives in `src/utils/betSlip.ts`.
- The app ships no offline service worker: home-screen install is manifest-only (`public/manifest.webmanifest`) and `public/sw.js` is a kill-switch that removes the old one, because auto-updating workers reloaded the page on phones.
- Desk picks are logged to `research_pick_log` (via `desk-bets` `log_picks`, first snapshot per day kept, tagged with `MODEL_VERSION` from `nbaProjection.ts`) and graded by `research-daily`; bump `MODEL_VERSION` whenever projection rules change so versions can be compared.

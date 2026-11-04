# Project rules

- NBA research (/research): box-score math lives in `src/utils/nbaBoxScoreMath.ts` with a copy in `supabase/functions/_shared/research/math.ts`; keep both in sync, because edge functions cannot import from `src/`.
- Research data refreshes through the single daily `research-daily` job (box scores and injuries from ESPN, lines from The Odds API, then AI top plays). Add new feeds as steps there instead of new cron jobs, so AI and API usage stays at one run per day.
- Research AI calls go only through `supabase/functions/_shared/research/ai.ts`. A 402/403 response pauses the daily job (`research_job_state.paused_reason`) so it stops spending credits.
- The site root `/` is the research desk (`src/pages/Desk.tsx`, Midnight Amber theme in `src/components/desk/desk-tokens.css`); the marketing landing page lives at `/landing` (`src/pages/Home.tsx`). Keep desk styling scoped to `.desk-theme` so it never leaks into the marketing pages.
- Desk top picks come from `src/utils/nbaProjection.ts` (projection + Over/Under chosen by expected profit at posted odds); keep it pure and tested so the ranking stays explainable.
- Real bets live in `research_real_bets`, read and written only through the `desk-bets` edge function (passcode-checked, no public policies); the daily `research-daily` job grades them from box scores.

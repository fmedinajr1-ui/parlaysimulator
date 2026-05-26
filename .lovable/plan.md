## Goal

Run `scripts/scout-speed-smoke.ts --scenarios` automatically on pull requests so we catch breakage in the ingest → edge → DB → Telegram pipeline before merge. Skip cleanly when secrets aren't available (fork PRs) so we don't false-fail.

## Files

**New: `.github/workflows/scout-speed-smoke.yml`**

Triggers
- `pull_request` against `main` — only when scout-speed surface area changes:
  - `supabase/functions/scout-live-edge/**`
  - `supabase/functions/market-snapshot-ingest/**`
  - `supabase/functions/edge-resolver/**`
  - `supabase/functions/closing-line-resolver/**`
  - `supabase/functions/_shared/scout-speed/**`
  - `scripts/scout-speed-smoke.ts`
  - `.github/workflows/scout-speed-smoke.yml`
- `workflow_dispatch` for manual runs.

Concurrency
- Group by ref so back-to-back PR pushes cancel earlier runs.

Job: `smoke` (runs on `ubuntu-latest`)
1. `actions/checkout@v4`
2. `oven-sh/setup-bun@v2` (bun ≥ 1.1)
3. **Preflight step** — check if `ODDS_FEED_WEBHOOK_SECRET` is non-empty. If empty, emit a notice (`echo "::notice ::Webhook secrets unavailable — likely a fork PR; skipping smoke."`), set an output `has_secrets=false`, and `exit 0`. This is how we gate fork PRs without failing the check.
4. Subsequent steps `if: steps.preflight.outputs.has_secrets == 'true'`:
   - Run `bun scripts/scout-speed-smoke.ts --scenarios` with env:
     - `ODDS_FEED_WEBHOOK_SECRET`
     - `LIVE_EVENT_WEBHOOK_SECRET`
     - `SUPABASE_SERVICE_ROLE_KEY`
   - Timeout 5 min.
5. On failure, the script already exits non-zero with per-scenario detail, which becomes the failing check.

Permissions: `contents: read` only.

## Required GitHub repo secrets

User adds these once in **Settings → Secrets and variables → Actions**:
- `ODDS_FEED_WEBHOOK_SECRET`
- `LIVE_EVENT_WEBHOOK_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`

(They already exist as Lovable Cloud runtime secrets — they need to be copied into the GitHub repo for Actions.)

## Fork-PR safety

GitHub doesn't expose secrets to PRs from forks. The preflight step detects the empty secret and exits 0 with a notice, so the workflow is green but obviously a no-op. Branch-protection rules can keep allowing merges; for fork contributions, a maintainer pushes to a branch in the main repo to actually execute the smoke run.

## Out of scope

- Running the full Deno test suite (`supabase/functions/_shared/scout-speed/scout-speed_test.ts`) — separate workflow if/when wanted; this plan stays focused on the live end-to-end harness as requested.
- Posting alert results back to the PR as a comment.
- Scheduled nightly runs against production endpoints.

## After approval

1. Create `.github/workflows/scout-speed-smoke.yml`.
2. Tell the user exactly which three secrets to add in GitHub repo settings, with a one-line description of each.


Current status from code + logs:
- Repository has the new logic (diversity v2.0 code and the new exposure accounting; cluster L10 gate with percent normalization).
- Runtime is still executing old deployments:
  - `bot-daily-diversity-rebalance` logs still show old text: `voided 0 parlays from X candidates`.
  - `bot_activity_log` entries for `diversity_rebalance` still miss `version` and the new exposure metadata fields.
  - latest pending `shootout_stack` legs still store `hit_rate` as decimals (`0.74`, `0.67`), which the new code would not produce.

Why it’s not working:
- This is deployment/runtime drift (stale deployed functions), not a logic bug in the checked-in files.

Implementation plan:
1) Redeploy the affected backend functions together
- `bot-generate-daily-parlays`
- `bot-daily-diversity-rebalance`
- `bot-force-fresh-parlays`

2) Make deployment behavior explicit
- Add `[functions.bot-daily-diversity-rebalance] verify_jwt = false` in `supabase/config.toml` so this function is explicitly configured like the rest of the pipeline.

3) Add runtime fingerprinting (anti-stale safeguard)
- Log a hard `VERSION` marker at run start in both functions.
- Persist `version` in `bot_activity_log.metadata` and include it in JSON responses where applicable.

4) Verify after one Clean & Rebuild
- Diversity logs must show: `raw candidates=..., already voided by strategy=..., actually voided=...`.
- Latest `diversity_rebalance` activity row must include:
  - `version`
  - `exposureCandidatesRaw`
  - `exposureAlreadyVoidedByStrategy`
  - `exposureCandidatesAfterStrategyFilter`
  - `exposureVoided`
- Latest pending `shootout_stack` must have percent-scale `hit_rate` values (e.g., `74`, not `0.74`) and no legs below 80 passing that gate.

5) If still stale after redeploy
- Treat as deployment pipeline issue and redeploy one-by-one while checking function logs after each deployment before re-running Clean & Rebuild.

## Goal

You upgraded ElevenLabs — but before we burn another render, let's (1) verify the new quota is live on the key, and (2) figure out where the previous 299,710 characters went.

## Step 1 — Verify new quota (no credits spent)

Hit ElevenLabs' `/v1/user/subscription` endpoint with the configured `ELEVENLABS_API_KEY`. This is a free read — zero characters consumed. Returns:
- `tier` (e.g. Pro / Scale)
- `character_count` (used this cycle)
- `character_limit` (total)
- `next_character_count_reset_unix`

I'll report back the exact numbers so you can confirm the upgrade is on the right key before we render anything.

## Step 2 — Audit where the credits went

Two parallel lookups, both read-only:

**A. Our app's usage** — sum the script lengths for every `tiktok_video_renders` row this billing cycle (success + failed). If our app only used ~2–3k characters but ElevenLabs shows 299k used, the key is shared with something outside this project.

**B. ElevenLabs history** — call `/v1/history?page_size=100` with the key. This returns every TTS generation made with that key, regardless of which app made it (timestamps, voice, character count, source). That's the ground truth for "where did the credits go."

I'll cross-reference: app usage vs. ElevenLabs history. Three possible outcomes:
- App usage ≈ ElevenLabs usage → our retry loop did burn them (worth a postmortem of the failed-render rows).
- App usage ≪ ElevenLabs usage → another app/project is sharing the key.
- ElevenLabs history shows generations we didn't initiate → key may be leaked.

## Step 3 — Only after you've seen the audit

If you're satisfied, I'll trigger one render of the pending approved script. Until you say go, no TTS calls.

## Technical details

- New temporary edge function `tiktok-elevenlabs-audit` (read-only, admin-gated): fetches `/v1/user/subscription` and `/v1/history`, joins with a `tiktok_video_renders` aggregation, returns a JSON summary. Zero character cost.
- I'll call it via `curl_edge_functions` and paste the result back here.
- No changes to `tiktok-render-orchestrator` or the cron in this plan.

Approve and I'll build the audit function, run it, and show you the numbers before anything renders.
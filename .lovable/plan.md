
## What's broken

The digest is rendering 🟢 ("actionable") for categories that contain no actionable info. Three root causes:

1. **Prompts are open-ended and ask Perplexity to "list" things.** Sonar often responds with "Here's how I can help — paste your slate" or framework descriptions ("a projection model for the player stat, a probability model…"). Those are instructions, not intel.
2. **The insight extractor grabs any bullet >20 chars.** It pulls in meta-lines like "Analyze a slate you paste in", "Identify relevant elite players", "Status: Not available", "Source: OddsIndex snippet", "What we can say from the snippet…".
3. **Relevance score = count of bullets only.** 6 garbage bullets = 0.85 score = 🟢. There is no quality gate.

Result: the "Table Tennis Signals" category gets a 🟢 from three "Identify / Explain / Flag" bullets, and "NCAA Baseball" gets a 🟢 from "Analyze a slate you paste in".

## Fix plan

### 1. Rewrite the 16 prompts to force concrete output

Each prompt becomes a strict template:

- Date stamp the prompt: `For games on {ET date} only.`
- Demand structured rows: `Return up to 5 bullets. Each bullet MUST contain a team or player name, a side/line, and a one-sentence reason. If you cannot find real intel, reply with exactly: NO_INTEL.`
- Forbid framework talk: `Do NOT describe methodology, do NOT ask for input, do NOT say "paste your slate". Only return real intel you can cite from web search.`
- Keep `search_recency_filter: "day"` and lower `temperature` to 0.1.

System message also hardened: "You are reporting real, current betting intel. If none exists, return NO_INTEL. Never describe what you would do — only what is true today."

### 2. Harden `extractInsights`

Reject a bullet if any of:

- Matches `/^(identify|analyze|explain|flag|provide|paste|list out|determine|consider)/i` (instruction verbs).
- Contains `not available`, `no match stats`, `not shown in the snippet`, `from the snippet`, `placeholder`, `n/a`, `unavailable`, `here's how`, `i can help`, `share your`, `paste your`.
- Starts with `Source:`, `Status:`, `Event/surface:`, `Recent form`, `Surface win rate`, `Opening line vs current line` (label-only lines with no value).
- Has no digit AND no capitalized proper-noun token (real picks always have a team/player or a number).
- Is `NO_INTEL` (whole category gets marked empty).

Also collapse Markdown bullets cleanly and drop any bullet that's just a sub-bullet of a meta line (track indentation).

### 3. Rework relevance score to measure quality, not count

```text
qualityScore =
  0.5 * (kept_insights / 5, capped at 1)
+ 0.3 * (fraction of insights mentioning a real number/line)
+ 0.2 * (fraction mentioning a known team/player token)
```

Thresholds:

- `>= 0.65` → 🟢 actionable
- `>= 0.40` → 🟡 thin
- `<  0.40` OR insights empty OR NO_INTEL → 🔴 and the category is dropped from the digest entirely (not rendered as a 🔴 stub).

### 4. Broadcast changes

- Skip any category that ends up empty after filtering instead of printing a 🟢 with junk.
- Summary line becomes `X/16 categories with verified intel` based on the new gate.
- If fewer than 4 categories survive, the broadcaster sends a short admin-only note ("Low-signal day — research digest skipped") and does **not** spam the channel.

### 5. Whale cross-reference unchanged

Still scans surviving insights for player/team mentions and applies the `research_boost`. With cleaner insights this stops boosting on noise like "Source: OddsIndex snippet".

## Files touched

- `supabase/functions/ai-research-agent/index.ts` — new `CATEGORIES` prompts, new `extractInsights`, new `qualityScore`, `temperature: 0.1`.
- `supabase/functions/ai-research-broadcast/index.ts` — drop empty categories, low-signal short-circuit, updated summary line.
- No schema changes. `bot_research_findings.relevance_score` keeps the same column, just populated by the new formula.

## Verification (per project testing policy: 5 independent checks)

1. Dry-run `ai-research-agent` and inspect raw Perplexity output vs. kept insights for 3 categories that were 🟢-with-junk (table tennis, NCAA baseball, statistical models).
2. Dry-run `ai-research-broadcast` with `dry_run: true` and confirm those 3 categories are now dropped or downgraded.
3. Force a `NO_INTEL` reply on one category (temporarily inject) and confirm it's filtered out, not rendered.
4. Confirm whale `research_boost` only fires on insights containing a real player/team token.
5. Compare today's vs. yesterday's stored `relevance_score` distribution in `bot_research_findings` to confirm the new scale is meaningfully different (fewer 0.85 across the board).



# Fix AI Research Agent Errors

## Problems Found

### 1. Telegram Digest Failing ("sent: false")
The digest message is too long for Telegram (4096 char limit). With 11 categories, each showing up to 3 insights at 150 chars each, the message easily hits 5000+ characters. Additionally, Perplexity responses contain special characters like parentheses, brackets, and underscores that break Telegram's Markdown parser -- causing the "Markdown failed, retrying plain text" warning.

### 2. Duplicate Research Runs
The logs show the agent running 4-5 times in quick succession (every 1-2 minutes). This wastes Perplexity API credits and creates duplicate entries in `bot_research_findings`.

## Fixes

### File: `supabase/functions/ai-research-agent/index.ts`

**Fix 1 -- Telegram Message Length**
- Truncate the digest to fit under 4096 characters
- Show only the category name, insight count, and relevance level (no full insight text)
- Add a character-count check before sending; if over limit, trim to summary-only format
- Use `MarkdownV2` parse mode with proper character escaping (escape `.`, `-`, `(`, `)`, `!`, etc.) or switch to HTML parse mode which is more forgiving

**Fix 2 -- Escape Special Characters**
- Before building the Telegram message, sanitize all insight text by escaping Markdown-reserved characters
- Or switch to `parse_mode: 'HTML'` which handles special chars more gracefully and use `<b>` tags instead of `*` for bold

**Fix 3 -- Deduplicate Runs**
- Before running the research, check `bot_research_findings` for entries with today's date
- If entries already exist for today, skip the research and return early with a "already ran today" message
- This prevents wasted API calls and duplicate data

### Expected Code Changes

**Deduplication guard** (near the top of the handler, after Supabase client creation):
- Query `bot_research_findings` for `research_date = today`
- If count > 0, return early with a message saying research already completed

**Telegram formatting** (in the digest builder):
- Switch from `parse_mode: 'Markdown'` to `parse_mode: 'HTML'`
- Replace `*bold*` with `<b>bold</b>`
- Cap message at 4000 characters with truncation indicator
- Show compact format: emoji + category + insight count + relevance badge

**Result**: Research runs once per day, Telegram digest reliably delivers a clean summary under the character limit.


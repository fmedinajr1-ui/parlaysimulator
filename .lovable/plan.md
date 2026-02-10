

# Update The Odds API Key

## What needs to happen
Update the `THE_ODDS_API_KEY` secret with the new value: `f914a2a0389d4bed0913bae3eec98c30`

This will fix the 401 errors across all edge functions that call The Odds API (`whale-odds-scraper`, `stream-live-odds`, etc.), allowing team bets and player props data to flow again.

## Steps
1. Update the `THE_ODDS_API_KEY` secret with the new key
2. Test the scraper to confirm 401 errors are resolved

## Additional fixes (from prior plan)
Once approved, I will also apply the Telegram and UI fixes discussed earlier:
- Fix Telegram MarkdownV2 parse errors (replace special chars, add plain-text fallback)
- Improve Team Bets empty state to show recent games when no upcoming ones exist
- Add guard in bot generator for empty odds data


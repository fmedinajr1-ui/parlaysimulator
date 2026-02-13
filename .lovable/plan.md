

# Enhance Research Agent: NCAA Baseball Pitching Matchups + Weather Impact

## What Changes

Add two new research categories to the AI research agent so it gathers daily intelligence on:

1. **NCAA Baseball Pitching Matchups** -- starting pitcher stats, ERA comparisons, bullpen depth, and recent form for today's games
2. **Weather Impact on Totals** -- wind speed/direction, temperature, humidity, and park factors that affect over/under lines

These findings will flow through the existing research-to-generation bridge, giving the scoring engine and parlay generator richer context for NCAA baseball bets.

## How It Works

### New Research Queries

Two entries are added to the `RESEARCH_QUERIES` array:

**`ncaa_baseball_pitching`**
- Asks Perplexity for today's probable NCAA baseball starting pitchers, their season ERAs, recent game logs (last 3 starts), bullpen usage/fatigue, and any pitcher injuries or pitch-count limitations.
- System prompt focuses on actionable pitching matchup data with specific stat lines.

**`weather_totals_impact`**
- Asks Perplexity for today's college baseball game-day weather: wind speed/direction, temperature, humidity at game-time for major matchups, plus known park factors (hitter-friendly vs pitcher-friendly).
- System prompt focuses on quantifying weather effects on run totals (e.g., "10+ mph wind blowing out historically adds 1.5 runs").

### Updated Telegram Digest

- New emoji mappings: baseball emoji for pitching matchups, cloud/wind emoji for weather
- Title map entries for the two new categories

### Generation Engine Integration

The existing `fetchResearchInjuryIntel` and `fetchResearchEdgeThreshold` functions already consume from `bot_research_findings` by category. A new companion function `fetchResearchPitchingWeather` will be added to the generation engine to:

1. Pull today's `ncaa_baseball_pitching` findings and extract pitcher names + ERA values
2. Pull today's `weather_totals_impact` findings and flag games where weather strongly favors overs or unders
3. Surface this as a `weatherBias` map (game key to "over"/"under"/"neutral") that the parlay generator can use when selecting totals legs

---

## Technical Details

### File 1: `supabase/functions/ai-research-agent/index.ts`

**Changes to `RESEARCH_QUERIES` array** (add 2 entries after line 35):

```typescript
{
  category: 'ncaa_baseball_pitching',
  query: "What are today's NCAA college baseball probable starting pitchers for the major conferences (SEC, ACC, Big 12, Big Ten, Pac-12)? Include each starter's season ERA, WHIP, last 3 game logs, and any pitch count or injury concerns. Also note any bullpen arms that are unavailable due to recent heavy usage.",
  systemPrompt: 'You are a college baseball pitching analyst. Provide specific pitcher names, teams, ERAs, WHIPs, and recent performance trends. Flag any starters on short rest or with declining velocity. Focus on data that would affect game totals and run lines.',
},
{
  category: 'weather_totals_impact',
  query: "What is today's weather forecast for major NCAA college baseball games? Include temperature, wind speed and direction relative to the field, humidity, and any rain delays expected. Which ballparks are known as hitter-friendly or pitcher-friendly? How does today's weather historically affect over/under totals?",
  systemPrompt: 'You are a sports weather analyst specializing in baseball. Quantify how weather conditions affect run scoring. Cite specific thresholds (e.g., wind >10mph blowing out adds ~1.5 runs). Include park factors and altitude effects. Be specific about which games are most impacted.',
},
```

**Changes to `titleMap`** (around line 123, add 2 entries):

```typescript
ncaa_baseball_pitching: 'NCAA Baseball Pitching Matchups',
weather_totals_impact: 'Weather Impact on Totals',
```

**Changes to Telegram emoji mapping** (around line 183, extend the ternary):

```typescript
const emoji = f.category === 'competing_ai' ? '🤖' :
              f.category === 'statistical_models' ? '📊' :
              f.category === 'ncaa_baseball_pitching' ? '⚾' :
              f.category === 'weather_totals_impact' ? '🌬️' : '🏥';
```

### File 2: `supabase/functions/bot-generate-daily-parlays/index.ts`

**New function `fetchResearchPitchingWeather`** (after the existing research intelligence section ~line 1280):

- Queries `bot_research_findings` for today's `ncaa_baseball_pitching` and `weather_totals_impact` categories
- From pitching findings: extracts pitcher names and ERA values using regex (e.g., `ERA 5.40` flags high-ERA starters as over-friendly)
- From weather findings: extracts wind/temperature signals using regex patterns like `wind.*blowing out`, `high humidity`, `cold.*pitcher` to produce a bias for each game
- Returns a `Map<string, 'over' | 'under' | 'neutral'>` keyed by team name
- This map is consumed during leg selection to boost or penalize totals picks

**Wire into main generation flow** (~line 1327):

- Add `fetchResearchPitchingWeather(supabase, gameDate)` to the parallel fetch
- Pass the weather bias map into the leg filtering logic so totals picks in weather-affected games get a score adjustment

### No Database Changes Required

Both new categories use the existing `bot_research_findings` table schema (category, title, summary, key_insights, sources, relevance_score, actionable). No migration needed.

### Post-Deploy

1. Deploy the updated `ai-research-agent` function
2. Invoke it to verify the two new categories produce findings
3. Deploy the updated `bot-generate-daily-parlays` function
4. The next parlay generation cycle will automatically consume the new research data


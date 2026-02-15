import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UnifiedPropInsert {
  player_name: string;
  prop_type: string;
  current_line: number;
  sport: string;
  event_id: string;
  bookmaker: string;
  game_description: string;
  commence_time: string;
  over_price: number | null;
  under_price: number | null;
  is_active: boolean;
}

const STAT_TYPE_MAP: Record<string, string> = {
  'points': 'player_points',
  'pts': 'player_points',
  'rebounds': 'player_rebounds',
  'reb': 'player_rebounds',
  'rebs': 'player_rebounds',
  'assists': 'player_assists',
  'ast': 'player_assists',
  'asts': 'player_assists',
  'threes': 'player_threes',
  'three pointers': 'player_threes',
  'three pointers made': 'player_threes',
  '3-pointers made': 'player_threes',
  '3-pt made': 'player_threes',
  '3pt': 'player_threes',
  'made threes': 'player_threes',
  'steals': 'player_steals',
  'blocks': 'player_blocks',
  'turnovers': 'player_turnovers',
  'pts+rebs+asts': 'player_points_rebounds_assists',
  'pts+rebs': 'player_points_rebounds',
  'pts+asts': 'player_points_assists',
  'rebs+asts': 'player_rebounds_assists',
};

function normalizeStatType(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return STAT_TYPE_MAP[lower] || `player_${lower.replace(/[^a-z0-9]+/g, '_')}`;
}

function parseGameTime(timeStr: string | undefined): string {
  if (!timeStr) return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  try {
    const isoDate = new Date(timeStr);
    if (!isNaN(isoDate.getTime())) return isoDate.toISOString();
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (timeMatch) {
      const [, hours, minutes, period] = timeMatch;
      let hour = parseInt(hours, 10);
      if (period.toUpperCase() === 'PM' && hour !== 12) hour += 12;
      if (period.toUpperCase() === 'AM' && hour === 12) hour = 0;
      const today = new Date();
      today.setHours(hour, parseInt(minutes, 10), 0, 0);
      if (today < new Date()) today.setDate(today.getDate() + 1);
      return today.toISOString();
    }
  } catch (_) { /* fallback */ }
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

// Extract props from markdown using regex patterns common across sportsbooks
function extractPropsFromMarkdown(markdown: string, bookmaker: string): Array<{
  player_name: string;
  stat_type: string;
  line: number;
  over_odds: number | null;
  under_odds: number | null;
  matchup: string | null;
}> {
  const props: Array<{
    player_name: string;
    stat_type: string;
    line: number;
    over_odds: number | null;
    under_odds: number | null;
    matchup: string | null;
  }> = [];

  const lines = markdown.split('\n');
  let currentMatchup: string | null = null;
  let currentStatType: string | null = null;

  // Patterns for matchup headers (e.g., "Team A @ Team B" or "Team A vs Team B")
  const matchupPattern = /(?:^|\|)\s*([A-Z][a-zA-Z\s&'.]+(?:\s+(?:@|vs\.?|at)\s+)[A-Z][a-zA-Z\s&'.]+)/;

  // Pattern for stat category headers
  const statCategoryPattern = /\b(Points|Rebounds|Assists|Threes|Three Pointers|3-Pointers Made|Steals|Blocks|Turnovers|Pts\+Rebs\+Asts|Pts\+Rebs|Pts\+Asts|Rebs\+Asts|Made Threes|3PT|3-PT Made)\b/i;

  // Pattern: "Player Name Over/Under X.X" with optional odds
  const propPatternOverUnder = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*[-–]?\s*(Over|Under|O|U)\s+(\d+\.?\d*)\s*(?:\(?([-+]\d{3,4})\)?)?/gi;

  // Pattern: "Player Name X.X" (line only, in table rows or lists)
  const propPatternLine = /(?:^|\|)\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s*\|?\s*(\d+\.?\d*)\s*\|?\s*([-+]\d{3,4})?\s*\|?\s*([-+]\d{3,4})?/;

  // Common non-player phrases to skip
  const skipNames = new Set([
    'player props', 'game lines', 'player points', 'player rebounds',
    'player assists', 'over under', 'college basketball', 'hard rock',
    'fan duel', 'see all', 'show more', 'view all', 'bet now',
    'sign up', 'log in', 'terms conditions', 'privacy policy',
  ]);

  function isValidPlayerName(name: string): boolean {
    const lower = name.toLowerCase().trim();
    if (skipNames.has(lower)) return false;
    if (lower.length < 4) return false;
    const parts = name.trim().split(/\s+/);
    if (parts.length < 2 || parts.length > 4) return false;
    // Check each part starts with uppercase
    if (!parts.every(p => /^[A-Z]/.test(p))) return false;
    // No all-caps words (likely headers)
    if (parts.some(p => p.length > 2 && p === p.toUpperCase())) return false;
    return true;
  }

  for (const line of lines) {
    // Check for matchup
    const matchupMatch = line.match(matchupPattern);
    if (matchupMatch) {
      currentMatchup = matchupMatch[1].trim();
    }

    // Check for stat category
    const statMatch = line.match(statCategoryPattern);
    if (statMatch) {
      currentStatType = statMatch[1];
    }

    // Try Over/Under pattern
    let match;
    const ouRegex = new RegExp(propPatternOverUnder.source, 'gi');
    while ((match = ouRegex.exec(line)) !== null) {
      const playerName = match[1].trim();
      const side = match[2].toUpperCase();
      const lineVal = parseFloat(match[3]);
      const odds = match[4] ? parseInt(match[4]) : null;

      if (isValidPlayerName(playerName) && !isNaN(lineVal) && lineVal > 0) {
        // Check if we already have this player+line
        const existing = props.find(p => p.player_name === playerName && p.line === lineVal);
        if (existing) {
          if (side.startsWith('O')) existing.over_odds = odds;
          else existing.under_odds = odds;
        } else {
          props.push({
            player_name: playerName,
            stat_type: currentStatType || 'Points',
            line: lineVal,
            over_odds: side.startsWith('O') ? odds : null,
            under_odds: side.startsWith('U') ? odds : null,
            matchup: currentMatchup,
          });
        }
      }
    }

    // Try table row pattern
    const tableMatch = line.match(propPatternLine);
    if (tableMatch) {
      const playerName = tableMatch[1].trim();
      const lineVal = parseFloat(tableMatch[2]);
      const odds1 = tableMatch[3] ? parseInt(tableMatch[3]) : null;
      const odds2 = tableMatch[4] ? parseInt(tableMatch[4]) : null;

      if (isValidPlayerName(playerName) && !isNaN(lineVal) && lineVal > 0) {
        const exists = props.find(p => p.player_name === playerName && p.line === lineVal);
        if (!exists) {
          props.push({
            player_name: playerName,
            stat_type: currentStatType || 'Points',
            line: lineVal,
            over_odds: odds1,
            under_odds: odds2,
            matchup: currentMatchup,
          });
        }
      }
    }
  }

  return props;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const {
      books = ['fanduel', 'hardrock'],
      sport = 'basketball_ncaab',
    } = body;

    console.log(`[Sportsbook Scraper] Starting for ${sport} from:`, books);

    if (!firecrawlKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'FIRECRAWL_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Multiple URLs per book to maximize prop coverage
    const BOOK_URLS: Record<string, Array<{ url: string; bookmaker: string }>> = {
      fanduel: [
        { url: 'https://sportsbook.fanduel.com/college-basketball?tab=player-props', bookmaker: 'fanduel' },
        { url: 'https://sportsbook.fanduel.com/college-basketball/player-props', bookmaker: 'fanduel' },
        { url: 'https://sportsbook.fanduel.com/college-basketball', bookmaker: 'fanduel' },
      ],
      hardrock: [
        { url: 'https://www.hardrocksportsbook.com/sports/basketball/college-basketball/player-props', bookmaker: 'hardrock' },
        { url: 'https://www.hardrocksportsbook.com/sports/basketball/college-basketball', bookmaker: 'hardrock' },
      ],
    };

    const allProps: UnifiedPropInsert[] = [];
    const results: Record<string, { attempted: number; propsFound: number }> = {};

    for (const bookKey of books) {
      const urls = BOOK_URLS[bookKey];
      if (!urls) {
        console.log(`[Sportsbook Scraper] Unknown book: ${bookKey}`);
        continue;
      }

      results[bookKey] = { attempted: 0, propsFound: 0 };
      const seenPlayers = new Set<string>();

      for (const { url, bookmaker } of urls) {
        results[bookKey].attempted++;
        console.log(`[Sportsbook Scraper] Scraping ${bookmaker}: ${url}`);

        try {
          const scrollActions = [
            { type: 'wait', milliseconds: 5000 },
            { type: 'scroll', direction: 'down' },
            { type: 'wait', milliseconds: 2000 },
            { type: 'scroll', direction: 'down' },
            { type: 'wait', milliseconds: 2000 },
            { type: 'scroll', direction: 'down' },
            { type: 'wait', milliseconds: 2000 },
            { type: 'scroll', direction: 'down' },
            { type: 'wait', milliseconds: 3000 },
          ];

          const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${firecrawlKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url,
              actions: scrollActions,
              formats: ['markdown'],
              timeout: 90000,
              onlyMainContent: false,
            }),
          });

          if (!response.ok) {
            const err = await response.text();
            console.error(`[Sportsbook Scraper] Firecrawl error for ${url}:`, err);
            continue;
          }

          const data = await response.json();
          const markdown = data.data?.markdown || data.markdown || '';

          console.log(`[Sportsbook Scraper] Got ${markdown.length} chars of markdown from ${url}`);

          if (markdown.length < 100) {
            console.log(`[Sportsbook Scraper] Markdown too short, skipping`);
            continue;
          }

          // Log a sample of the markdown for debugging
          console.log(`[Sportsbook Scraper] Markdown sample (first 500 chars):`, markdown.substring(0, 500));

          const extracted = extractPropsFromMarkdown(markdown, bookmaker);
          console.log(`[Sportsbook Scraper] Regex extracted ${extracted.length} props from ${url}`);

          for (const prop of extracted) {
            const dedupKey = `${prop.player_name}_${prop.stat_type}_${bookmaker}`;
            if (seenPlayers.has(dedupKey)) continue;
            seenPlayers.add(dedupKey);

            const propType = normalizeStatType(prop.stat_type);
            const commenceTime = parseGameTime(undefined); // We'll use default since page rarely shows times cleanly

            allProps.push({
              player_name: prop.player_name,
              prop_type: propType,
              current_line: prop.line,
              sport,
              event_id: `${bookmaker}_ncaab_${prop.player_name.replace(/\s+/g, '_').toLowerCase()}_${propType}`,
              bookmaker,
              game_description: prop.matchup || 'NCAAB Game',
              commence_time: commenceTime,
              over_price: prop.over_odds,
              under_price: prop.under_odds,
              is_active: true,
            });
          }

          results[bookKey].propsFound += extracted.length;

          // If we got props from this URL, skip remaining URLs for this book
          if (extracted.length > 0) {
            console.log(`[Sportsbook Scraper] Got ${extracted.length} props from ${url}, skipping remaining URLs for ${bookKey}`);
            break;
          }
        } catch (err) {
          console.error(`[Sportsbook Scraper] Error scraping ${url}:`, err);
        }
      }
    }

    // Upsert into unified_props
    let totalInserted = 0;
    if (allProps.length > 0) {
      const uniqueMap = new Map<string, UnifiedPropInsert>();
      for (const prop of allProps) {
        uniqueMap.set(`${prop.event_id}_${prop.bookmaker}`, prop);
      }
      const deduped = Array.from(uniqueMap.values());

      for (let i = 0; i < deduped.length; i += 100) {
        const batch = deduped.slice(i, i + 100);
        const { error } = await supabase
          .from('unified_props')
          .upsert(batch, {
            onConflict: 'event_id,player_name,prop_type,bookmaker',
            ignoreDuplicates: false,
          });
        if (error) {
          console.error(`[Sportsbook Scraper] Upsert error:`, error);
        } else {
          totalInserted += batch.length;
        }
      }
    }

    await supabase.from('cron_job_history').insert({
      job_name: 'sportsbook-props-scraper',
      status: 'completed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result: { sport, books, results, totalInserted },
    });

    return new Response(
      JSON.stringify({
        success: true,
        sport,
        books,
        results,
        totalInserted,
        sampleProps: allProps.slice(0, 5).map(p => ({
          player: p.player_name,
          prop: p.prop_type,
          line: p.current_line,
          book: p.bookmaker,
          matchup: p.game_description,
        })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Sportsbook Scraper] Fatal:', msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

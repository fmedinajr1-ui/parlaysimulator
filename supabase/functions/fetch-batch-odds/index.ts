import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const PRIORITY_BOOKMAKERS = ['hardrockbet', 'fanduel', 'draftkings'];
const FALLBACK_BOOKMAKERS = ['betmgm', 'caesars', 'pointsbet', 'bovada', 'williamhill_us'];

const normalizeName = (name: string) => {
  return name.toLowerCase()
    .replace(/\./g, '')
    .replace(/'/g, '')
    .replace(/jr$/i, '')
    .replace(/sr$/i, '')
    .replace(/iii$/i, '')
    .replace(/ii$/i, '')
    .trim();
};

interface PlayerRequest {
  player_name: string;
  prop_type: string;
}

interface PlayerResult {
  player_name: string;
  prop_type: string;
  success: boolean;
  odds?: {
    line: number;
    over_price: number | null;
    under_price: number | null;
    bookmaker: string;
    bookmaker_title?: string;
    last_update?: string;
  };
  all_odds?: Array<{
    line: number;
    over_price: number | null;
    under_price: number | null;
    bookmaker: string;
  }>;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      sport = 'basketball_nba',
      players,
      preferred_bookmakers = PRIORITY_BOOKMAKERS,
      return_all_books = true,
    }: {
      sport?: string;
      players: PlayerRequest[];
      preferred_bookmakers?: string[];
      return_all_books?: boolean;
    } = await req.json();

    if (!players || players.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No players provided' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const apiKey = Deno.env.get('THE_ODDS_API_KEY');
    if (!apiKey) {
      throw new Error('THE_ODDS_API_KEY not configured');
    }

    console.log(`[fetch-batch-odds] Batch request for ${players.length} players`);

    // Group players by prop_type (market) so we make ONE API call per market
    const marketGroups = new Map<string, PlayerRequest[]>();
    for (const p of players) {
      const market = p.prop_type;
      if (!marketGroups.has(market)) marketGroups.set(market, []);
      marketGroups.get(market)!.push(p);
    }

    const bookmakersToSearch = [...preferred_bookmakers, ...FALLBACK_BOOKMAKERS];
    const bookmakerParam = bookmakersToSearch.join(',');

    // First we need to get active events for this sport
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${apiKey}&regions=us&markets=${Array.from(marketGroups.keys()).join(',')}&oddsFormat=american&bookmakers=${bookmakerParam}`;

    console.log(`[fetch-batch-odds] Fetching ${marketGroups.size} markets across all events`);
    
    const response = await fetchWithTimeout(eventsUrl);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${await response.text()}`);
    }

    const events: any[] = await response.json();
    console.log(`[fetch-batch-odds] Got ${events.length} events`);

    // For each player, find their odds across all events and bookmakers
    const results: PlayerResult[] = [];

    for (const player of players) {
      const playerNameNorm = normalizeName(player.player_name);
      const marketKey = player.prop_type;
      let bestOdds: PlayerResult['odds'] = undefined;
      const allOdds: NonNullable<PlayerResult['all_odds']> = [];

      for (const event of events) {
        for (const bm of (event.bookmakers || [])) {
          for (const market of (bm.markets || [])) {
            if (market.key !== marketKey) continue;

            // Find this player in outcomes
            const overOutcome = (market.outcomes || []).find((o: any) =>
              o.name === 'Over' && normalizeName(o.description || '').includes(playerNameNorm)
            );
            const underOutcome = (market.outcomes || []).find((o: any) =>
              o.name === 'Under' && normalizeName(o.description || '').includes(playerNameNorm)
            );

            if (!overOutcome && !underOutcome) continue;

            const line = overOutcome?.point ?? underOutcome?.point;
            if (line == null) continue;

            const entry = {
              line,
              over_price: overOutcome?.price ?? null,
              under_price: underOutcome?.price ?? null,
              bookmaker: bm.key,
              bookmaker_title: bm.title,
              last_update: market.last_update,
            };

            allOdds.push(entry);

            // Pick best odds using priority order
            if (!bestOdds) {
              bestOdds = entry;
            } else {
              const currentPriority = bookmakersToSearch.indexOf(bm.key);
              const bestPriority = bookmakersToSearch.indexOf(bestOdds.bookmaker);
              if (currentPriority >= 0 && (bestPriority < 0 || currentPriority < bestPriority)) {
                bestOdds = entry;
              }
            }
          }
        }
      }

      results.push({
        player_name: player.player_name,
        prop_type: player.prop_type,
        success: !!bestOdds,
        odds: bestOdds,
        all_odds: return_all_books ? allOdds : undefined,
      });
    }

    const found = results.filter(r => r.success).length;
    console.log(`[fetch-batch-odds] Found odds for ${found}/${players.length} players`);

    return new Response(JSON.stringify({
      success: true,
      results,
      events_searched: events.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[fetch-batch-odds] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

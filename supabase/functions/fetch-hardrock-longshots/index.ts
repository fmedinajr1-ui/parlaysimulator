import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const PROP_MARKETS = [
  'player_points',
  'player_rebounds',
  'player_assists',
  'player_threes',
  'player_points_rebounds_assists',
  'player_steals',
  'player_blocks',
];

const MIN_ODDS = 650;

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('THE_ODDS_API_KEY');
    if (!apiKey) throw new Error('THE_ODDS_API_KEY not configured');

    const sport = 'basketball_nba';
    const longshots: any[] = [];

    // Step 1: Fetch moneyline (h2h) odds — uses the sport-level endpoint
    const h2hUrl = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${apiKey}&regions=us&markets=h2h&oddsFormat=american&bookmakers=hardrockbet`;
    console.log(`[fetch-hardrock-longshots] Fetching h2h odds`);
    const h2hRes = await fetchWithTimeout(h2hUrl);
    if (!h2hRes.ok) {
      const t = await h2hRes.text();
      throw new Error(`h2h API error ${h2hRes.status}: ${t}`);
    }
    const events: any[] = await h2hRes.json();
    console.log(`[fetch-hardrock-longshots] Got ${events.length} events`);

    // Collect h2h longshots
    for (const event of events) {
      const gameLabel = `${event.away_team} @ ${event.home_team}`;
      for (const bm of (event.bookmakers || [])) {
        if (bm.key !== 'hardrockbet') continue;
        for (const market of (bm.markets || [])) {
          for (const outcome of (market.outcomes || [])) {
            if (outcome.price >= MIN_ODDS) {
              longshots.push({
                game: gameLabel,
                commence_time: event.commence_time,
                market: 'moneyline',
                name: outcome.name,
                side: outcome.name,
                line: null,
                odds: `+${outcome.price}`,
                odds_raw: outcome.price,
              });
            }
          }
        }
      }
    }

    // Step 2: Fetch player props per event (requires event-level endpoint)
    const eventIds = events.map(e => e.id);
    console.log(`[fetch-hardrock-longshots] Fetching props for ${eventIds.length} events`);

    for (const eventId of eventIds) {
      const event = events.find(e => e.id === eventId);
      const gameLabel = event ? `${event.away_team} @ ${event.home_team}` : eventId;

      const propsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${PROP_MARKETS.join(',')}&oddsFormat=american&bookmakers=hardrockbet`;

      try {
        const propsRes = await fetchWithTimeout(propsUrl, 8000);
        if (!propsRes.ok) {
          const t = await propsRes.text();
          console.warn(`[fetch-hardrock-longshots] Props error for ${eventId}: ${propsRes.status} ${t}`);
          continue;
        }
        const propsData = await propsRes.json();

        for (const bm of (propsData.bookmakers || [])) {
          if (bm.key !== 'hardrockbet') continue;
          for (const market of (bm.markets || [])) {
            for (const outcome of (market.outcomes || [])) {
              if (outcome.price >= MIN_ODDS) {
                longshots.push({
                  game: gameLabel,
                  commence_time: event?.commence_time,
                  market: market.key,
                  name: outcome.description || outcome.name,
                  side: outcome.name,
                  line: outcome.point ?? null,
                  odds: `+${outcome.price}`,
                  odds_raw: outcome.price,
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[fetch-hardrock-longshots] Timeout/error for event ${eventId}:`, err);
      }
    }

    longshots.sort((a, b) => b.odds_raw - a.odds_raw);
    console.log(`[fetch-hardrock-longshots] Found ${longshots.length} longshots at +${MIN_ODDS}+`);

    return new Response(JSON.stringify({
      success: true,
      count: longshots.length,
      min_odds: `+${MIN_ODDS}`,
      bookmaker: 'hardrockbet',
      sport,
      events_searched: events.length,
      longshots,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[fetch-hardrock-longshots] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

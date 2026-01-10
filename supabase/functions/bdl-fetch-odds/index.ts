import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// V1 for games, players, stats - V2 for betting endpoints only
const BDL_V1_URL = 'https://api.balldontlie.io/v1';
const BDL_V2_URL = 'https://api.balldontlie.io/v2';

// Map BDL prop types to our unified format
const PROP_TYPE_MAP: Record<string, string> = {
  'points': 'points',
  'rebounds': 'rebounds',
  'assists': 'assists',
  'threes': 'threes',
  'steals': 'steals',
  'blocks': 'blocks',
  'turnovers': 'turnovers',
  'pts_rebs_asts': 'points_rebounds_assists',
  'pts_rebs': 'points_rebounds',
  'pts_asts': 'points_assists',
  'rebs_asts': 'rebounds_assists',
  'stls_blks': 'steals_blocks',
  'double_double': 'double_double',
  'triple_double': 'triple_double',
  'points_1q': 'points_1q',
  'points_first3min': 'points_first3min',
  'assists_first3min': 'assists_first3min',
};

interface BDLGame {
  id: number;
  date: string;
  home_team: { id: number; full_name: string; abbreviation: string };
  visitor_team: { id: number; full_name: string; abbreviation: string };
  status: string;
  time?: string;
}

interface BDLPlayerProp {
  game_id: number;
  player_id: number;
  player?: { first_name: string; last_name: string }; // May or may not be present
  vendor: string;
  prop_type: string;
  line_value: string;
  market: {
    type: 'over_under' | 'milestone';
    over_odds?: number;
    under_odds?: number;
    odds?: number;
  };
}

// Helper to get player name from prop (handles both formats)
function getPlayerName(prop: BDLPlayerProp): string {
  if (prop.player && prop.player.first_name && prop.player.last_name) {
    return `${prop.player.first_name} ${prop.player.last_name}`;
  }
  // Fallback: use player_id as placeholder (will need to be resolved)
  return `Player_${prop.player_id}`;
}

// Delay helper for rate limiting
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Resolve player IDs to names with caching
async function resolvePlayerNames(
  playerIds: number[],
  headers: HeadersInit,
  supabase: any
): Promise<Map<number, string>> {
  const playerMap = new Map<number, string>();
  const uniqueIds = [...new Set(playerIds.filter(id => id > 0))];
  
  if (uniqueIds.length === 0) return playerMap;
  
  console.log(`[bdl-fetch-odds] Resolving ${uniqueIds.length} unique player IDs`);
  
  // Step 1: Check cache first
  const { data: cached } = await supabase
    .from('bdl_player_cache')
    .select('bdl_player_id, player_name')
    .in('bdl_player_id', uniqueIds);
  
  for (const player of cached || []) {
    if (player.bdl_player_id && player.player_name) {
      playerMap.set(player.bdl_player_id, player.player_name);
    }
  }
  
  console.log(`[bdl-fetch-odds] Found ${playerMap.size} players in cache`);
  
  // Step 2: Fetch missing players from BDL API
  const missingIds = uniqueIds.filter(id => !playerMap.has(id));
  
  if (missingIds.length > 0) {
    console.log(`[bdl-fetch-odds] Fetching ${missingIds.length} missing players from BDL API`);
    
    for (const playerId of missingIds) {
      try {
        const response = await fetch(`${BDL_V1_URL}/players/${playerId}`, { headers });
        if (response.ok) {
          const data = await response.json();
          if (data.data && data.data.first_name && data.data.last_name) {
            const name = `${data.data.first_name} ${data.data.last_name}`;
            playerMap.set(playerId, name);
            
            // Cache for future use
            await supabase.from('bdl_player_cache').upsert({
              bdl_player_id: playerId,
              player_name: name,
              position: data.data.position || null,
              team_name: data.data.team?.full_name || null,
              last_updated: new Date().toISOString(),
            }, { onConflict: 'bdl_player_id' });
          }
        }
        await delay(50); // Rate limiting
      } catch (err) {
        console.warn(`[bdl-fetch-odds] Failed to fetch player ${playerId}`);
      }
    }
    
    console.log(`[bdl-fetch-odds] Resolved ${playerMap.size} total players`);
  }
  
  return playerMap;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const bdlApiKey = Deno.env.get('BALLDONTLIE_API_KEY');
    if (!bdlApiKey) {
      throw new Error('BALLDONTLIE_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action = 'fetch_games', game_id, sync_to_db = false } = await req.json().catch(() => ({}));

    console.log(`[bdl-fetch-odds] Action: ${action}, game_id: ${game_id}`);

    const headers = {
      'Authorization': bdlApiKey,
      'Content-Type': 'application/json',
    };

    // Action: Fetch today's games
    if (action === 'fetch_games') {
      const today = new Date().toISOString().split('T')[0];
      const gamesUrl = `${BDL_V1_URL}/games?dates[]=${today}`;
      
      console.log(`[bdl-fetch-odds] Fetching games from: ${gamesUrl}`);
      
      const response = await fetch(gamesUrl, { headers });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[bdl-fetch-odds] Games API error: ${response.status} - ${errorText}`);
        throw new Error(`BDL API error: ${response.status}`);
      }
      
      const data = await response.json();
      const games: BDLGame[] = data.data || [];
      
      console.log(`[bdl-fetch-odds] Found ${games.length} games for ${today}`);

      return new Response(JSON.stringify({
        success: true,
        games: games.map(g => ({
          bdl_game_id: g.id,
          date: g.date,
          home_team: g.home_team.full_name,
          away_team: g.visitor_team.full_name,
          status: g.status,
        })),
        count: games.length,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Action: Fetch game odds (spreads, moneylines, totals)
    if (action === 'fetch_game_odds') {
      const today = new Date().toISOString().split('T')[0];
      const oddsUrl = `${BDL_V2_URL}/odds?dates[]=${today}`;
      
      console.log(`[bdl-fetch-odds] Fetching game odds from: ${oddsUrl}`);
      
      const response = await fetch(oddsUrl, { headers });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[bdl-fetch-odds] Odds API error: ${response.status} - ${errorText}`);
        
        // Check if it's a tier issue
        if (response.status === 403 || response.status === 401) {
          return new Response(JSON.stringify({
            success: false,
            error: 'BDL Betting Odds requires GOAT tier subscription',
            tier_required: 'GOAT',
          }), { 
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }
        throw new Error(`BDL API error: ${response.status}`);
      }
      
      const data = await response.json();
      console.log(`[bdl-fetch-odds] Fetched ${data.data?.length || 0} game odds`);

      return new Response(JSON.stringify({
        success: true,
        odds: data.data || [],
        count: data.data?.length || 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Action: Fetch player props for a specific game
    if (action === 'fetch_player_props') {
      if (!game_id) {
        throw new Error('game_id is required for fetch_player_props');
      }

      const propsUrl = `${BDL_V2_URL}/odds/player_props?game_id=${game_id}`;
      
      console.log(`[bdl-fetch-odds] Fetching player props from: ${propsUrl}`);
      
      const response = await fetch(propsUrl, { headers });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[bdl-fetch-odds] Props API error: ${response.status} - ${errorText}`);
        
        if (response.status === 403 || response.status === 401) {
          return new Response(JSON.stringify({
            success: false,
            error: 'BDL Player Props requires GOAT tier subscription',
            tier_required: 'GOAT',
          }), { 
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          });
        }
        throw new Error(`BDL API error: ${response.status}`);
      }
      
      const data = await response.json();
      const props: BDLPlayerProp[] = data.data || [];
      
      console.log(`[bdl-fetch-odds] Fetched ${props.length} player props for game ${game_id}`);

      // Transform to unified format
      const transformedProps = props.map(p => ({
        bdl_game_id: p.game_id,
        player_name: getPlayerName(p),
        vendor: p.vendor,
        prop_type: PROP_TYPE_MAP[p.prop_type] || p.prop_type,
        original_prop_type: p.prop_type,
        line: parseFloat(p.line_value),
        over_price: p.market.over_odds || null,
        under_price: p.market.under_odds || null,
        market_type: p.market.type,
      }));

      return new Response(JSON.stringify({
        success: true,
        props: transformedProps,
        count: transformedProps.length,
        raw_count: props.length,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Action: Sync BDL props to unified_props table
    if (action === 'sync_to_unified_props') {
      // Step 1: Get today's games from BDL
      const today = new Date().toISOString().split('T')[0];
      const gamesUrl = `${BDL_V1_URL}/games?dates[]=${today}`;
      
      const gamesResponse = await fetch(gamesUrl, { headers });
      if (!gamesResponse.ok) {
        throw new Error(`Failed to fetch games: ${gamesResponse.status}`);
      }
      
      const gamesData = await gamesResponse.json();
      const games: BDLGame[] = gamesData.data || [];
      
      console.log(`[bdl-fetch-odds] Syncing props for ${games.length} games`);

      if (games.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          message: 'No NBA games today',
          synced: 0,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      let totalProps = 0;
      const allRawProps: { prop: BDLPlayerProp; game: BDLGame }[] = [];

      // Step 2: Fetch props for each game
      for (const game of games) {
        const propsUrl = `${BDL_V2_URL}/odds/player_props?game_id=${game.id}`;
        
        try {
          const propsResponse = await fetch(propsUrl, { headers });
          
          if (!propsResponse.ok) {
            if (propsResponse.status === 403) {
              console.warn(`[bdl-fetch-odds] GOAT tier required for player props`);
              return new Response(JSON.stringify({
                success: false,
                error: 'BDL Player Props requires GOAT tier subscription',
                tier_required: 'GOAT',
              }), { 
                status: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
              });
            }
            console.warn(`[bdl-fetch-odds] Failed to fetch props for game ${game.id}`);
            continue;
          }
          
          const propsData = await propsResponse.json();
          const props: BDLPlayerProp[] = propsData.data || [];
          
          for (const prop of props) {
            allRawProps.push({ prop, game });
          }
          
          totalProps += props.length;
          
          // Rate limiting
          await delay(200);
          
        } catch (err) {
          console.error(`[bdl-fetch-odds] Error fetching props for game ${game.id}:`, err);
        }
      }

      if (allRawProps.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          message: 'No props found to sync',
          games: games.length,
          synced: 0,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Step 3: Resolve all player IDs to names
      const playerIds = allRawProps.map(r => r.prop.player_id);
      const playerNames = await resolvePlayerNames(playerIds, headers, supabase);
      
      console.log(`[bdl-fetch-odds] Resolved ${playerNames.size} player names`);

      // Step 4: Transform props with resolved names (using Map for deduplication)
      const propsMap = new Map<string, any>();
      
      for (const { prop, game } of allRawProps) {
        const propType = PROP_TYPE_MAP[prop.prop_type] || prop.prop_type;
        const gameDescription = `${game.visitor_team.full_name} @ ${game.home_team.full_name}`;
        const eventId = `bdl_${game.id}`;
        const gameDate = new Date(game.date);
        gameDate.setHours(19, 0, 0, 0);
        
        // Use resolved name or fallback
        let playerName = playerNames.get(prop.player_id);
        if (!playerName) {
          playerName = getPlayerName(prop);
        }
        
        const bookmaker = prop.vendor.toLowerCase();
        const line = parseFloat(prop.line_value);
        
        // Create unique key matching DB constraint: event_id,player_name,prop_type,bookmaker
        const key = `${eventId}-${playerName}-${propType}-${bookmaker}`;
        
        if (propsMap.has(key)) {
          // Merge over/under prices
          const existing = propsMap.get(key);
          if (prop.market.over_odds) existing.over_price = prop.market.over_odds;
          if (prop.market.under_odds) existing.under_price = prop.market.under_odds;
        } else {
          propsMap.set(key, {
            event_id: eventId,
            sport: 'basketball_nba',
            game_description: gameDescription,
            commence_time: gameDate.toISOString(),
            bookmaker: bookmaker,
            player_name: playerName,
            prop_type: propType,
            current_line: line,
            over_price: prop.market.over_odds || null,
            under_price: prop.market.under_odds || null,
            is_active: true,
            category: 'balldontlie',
          });
        }
      }

      const allUnifiedProps = Array.from(propsMap.values());
      console.log(`[bdl-fetch-odds] Deduplicated to ${allUnifiedProps.length} props to sync`);

      // Step 5: Upsert to unified_props
      if (allUnifiedProps.length > 0) {
        const batchSize = 100;
        let insertedCount = 0;
        
        for (let i = 0; i < allUnifiedProps.length; i += batchSize) {
          const batch = allUnifiedProps.slice(i, i + batchSize);
          
          const { error } = await supabase
            .from('unified_props')
            .upsert(batch, {
              onConflict: 'event_id,player_name,prop_type,bookmaker',
              ignoreDuplicates: false,
            });
          
          if (error) {
            console.error(`[bdl-fetch-odds] Upsert error:`, error);
          } else {
            insertedCount += batch.length;
          }
        }
        
        console.log(`[bdl-fetch-odds] Synced ${insertedCount} props to unified_props`);

        return new Response(JSON.stringify({
          success: true,
          message: `Synced ${insertedCount} BDL props with resolved player names`,
          games: games.length,
          synced: insertedCount,
          playersResolved: playerNames.size,
          source: 'balldontlie',
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({
        success: true,
        message: 'No props found to sync',
        games: games.length,
        synced: 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Action: Pre-populate player cache for all players in today's games
    if (action === 'populate_player_cache') {
      const today = new Date().toISOString().split('T')[0];
      const gamesUrl = `${BDL_V1_URL}/games?dates[]=${today}`;
      
      console.log(`[bdl-fetch-odds] Populating player cache for ${today}`);
      
      const gamesResponse = await fetch(gamesUrl, { headers });
      if (!gamesResponse.ok) {
        throw new Error(`Failed to fetch games: ${gamesResponse.status}`);
      }
      
      const gamesData = await gamesResponse.json();
      const games: BDLGame[] = gamesData.data || [];
      
      if (games.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          message: 'No NBA games today to cache players for',
          cached: 0,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      console.log(`[bdl-fetch-odds] Found ${games.length} games - fetching player props to extract IDs`);

      const allPlayerIds: Set<number> = new Set();

      // Fetch props for each game to extract player IDs
      for (const game of games) {
        try {
          const propsUrl = `${BDL_V2_URL}/odds/player_props?game_id=${game.id}`;
          const propsResponse = await fetch(propsUrl, { headers });
          
          if (!propsResponse.ok) {
            if (propsResponse.status === 403) {
              console.warn(`[bdl-fetch-odds] GOAT tier required`);
              return new Response(JSON.stringify({
                success: false,
                error: 'BDL Player Props requires GOAT tier subscription',
                tier_required: 'GOAT',
              }), { 
                status: 403,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
              });
            }
            continue;
          }
          
          const propsData = await propsResponse.json();
          const props: BDLPlayerProp[] = propsData.data || [];
          
          for (const prop of props) {
            if (prop.player_id > 0) {
              allPlayerIds.add(prop.player_id);
            }
          }
          
          await delay(150);
        } catch (err) {
          console.error(`[bdl-fetch-odds] Error fetching props for game ${game.id}:`, err);
        }
      }

      console.log(`[bdl-fetch-odds] Found ${allPlayerIds.size} unique player IDs to resolve`);

      if (allPlayerIds.size === 0) {
        return new Response(JSON.stringify({
          success: true,
          message: 'No player IDs found to cache',
          games: games.length,
          cached: 0,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Resolve all player names (this will populate the cache)
      const playerNames = await resolvePlayerNames(Array.from(allPlayerIds), headers, supabase);

      console.log(`[bdl-fetch-odds] Cached ${playerNames.size} player names`);

      return new Response(JSON.stringify({
        success: true,
        message: `Populated player cache with ${playerNames.size} players`,
        games: games.length,
        playersFound: allPlayerIds.size,
        cached: playerNames.size,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: false,
      error: `Unknown action: ${action}`,
      valid_actions: ['fetch_games', 'fetch_game_odds', 'fetch_player_props', 'sync_to_unified_props', 'populate_player_cache'],
    }), { 
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (err) {
    const error = err as Error;
    console.error('[bdl-fetch-odds] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});

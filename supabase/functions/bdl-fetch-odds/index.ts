import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BDL_BASE_URL = 'https://api.balldontlie.io/v2';

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
  player: { first_name: string; last_name: string };
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
      const gamesUrl = `${BDL_BASE_URL}/games?dates[]=${today}`;
      
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
      const oddsUrl = `${BDL_BASE_URL}/odds?dates[]=${today}`;
      
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

      const propsUrl = `${BDL_BASE_URL}/odds/player_props?game_id=${game_id}`;
      
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
        player_name: `${p.player.first_name} ${p.player.last_name}`,
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
      const gamesUrl = `${BDL_BASE_URL}/games?dates[]=${today}`;
      
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
      const allUnifiedProps: any[] = [];

      // Step 2: Fetch props for each game
      for (const game of games) {
        const propsUrl = `${BDL_BASE_URL}/odds/player_props?game_id=${game.id}`;
        
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
          
          // Generate a unique event_id for this game (BDL format)
          const eventId = `bdl_${game.id}`;
          
          // Estimate commence time from game date
          const gameDate = new Date(game.date);
          gameDate.setHours(19, 0, 0, 0); // Default to 7 PM local
          
          // Transform to unified_props format
          for (const prop of props) {
            const propType = PROP_TYPE_MAP[prop.prop_type] || prop.prop_type;
            
            allUnifiedProps.push({
              event_id: eventId,
              sport_key: 'basketball_nba',
              sport_title: 'NBA',
              home_team: game.home_team.full_name,
              away_team: game.visitor_team.full_name,
              commence_time: gameDate.toISOString(),
              bookmaker: prop.vendor.toLowerCase(),
              market_key: `player_${propType}`,
              player_name: `${prop.player.first_name} ${prop.player.last_name}`,
              prop_type: propType,
              line: parseFloat(prop.line_value),
              over_price: prop.market.over_odds || null,
              under_price: prop.market.under_odds || null,
              last_update: new Date().toISOString(),
              is_active: true,
              bdl_game_id: game.id,
            });
          }
          
          totalProps += props.length;
          
          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (err) {
          console.error(`[bdl-fetch-odds] Error fetching props for game ${game.id}:`, err);
        }
      }

      console.log(`[bdl-fetch-odds] Collected ${allUnifiedProps.length} props to sync`);

      // Step 3: Upsert to unified_props
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
          message: `Synced ${insertedCount} BDL props`,
          games: games.length,
          synced: insertedCount,
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

    return new Response(JSON.stringify({
      success: false,
      error: `Unknown action: ${action}`,
      valid_actions: ['fetch_games', 'fetch_game_odds', 'fetch_player_props', 'sync_to_unified_props'],
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

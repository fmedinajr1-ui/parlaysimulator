import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EnginePick {
  id: string;
  engine_name: string;
  sport: string;
  pick_description: string;
  player_name?: string;
  team_name?: string;
  prop_type?: string;
  line?: number;
  side?: string;
  odds?: number;
  confidence?: number;
  confidence_level?: string;
  signals?: any[];
  status: string;
  event_id?: string;
  game_time?: string;
  created_at: string;
}

// Map sport codes to readable names
function normalizeSport(sport: string): string {
  const sportMap: Record<string, string> = {
    'basketball_nba': 'NBA',
    'basketball_ncaab': 'NCAAB',
    'americanfootball_nfl': 'NFL',
    'americanfootball_ncaaf': 'NCAAF',
    'icehockey_nhl': 'NHL',
    'baseball_mlb': 'MLB',
    'soccer_epl': 'EPL',
    'mma_mixed_martial_arts': 'UFC',
    'tennis_atp': 'ATP Tennis',
    'tennis_wta': 'WTA Tennis',
    'tennis_pingpong': 'Table Tennis',
  };
  return sportMap[sport] || sport?.toUpperCase() || 'UNKNOWN';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { 
      mode = 'aggregate', 
      sport = null, 
      engine = null,
      syncToTracker = true 
    } = await req.json().catch(() => ({}));

    console.log(`[Unified Live Feed] Mode: ${mode}, Sport: ${sport}, Engine: ${engine}`);

    const allPicks: EnginePick[] = [];
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    // 1. Sharp Money Picks
    if (!engine || engine === 'sharp') {
      const { data: sharpPicks } = await supabase
        .from('line_movements')
        .select('*')
        .eq('is_primary_record', true)
        .gte('detected_at', todayStart)
        .order('detected_at', { ascending: false })
        .limit(50);

      for (const pick of sharpPicks || []) {
        if (sport && normalizeSport(pick.sport) !== sport) continue;
        
        allPicks.push({
          id: pick.id,
          engine_name: 'Sharp Money',
          sport: normalizeSport(pick.sport),
          pick_description: pick.final_pick || pick.recommendation || pick.description,
          player_name: pick.player_name,
          prop_type: pick.market_type,
          odds: pick.new_price,
          confidence: pick.authenticity_confidence ? pick.authenticity_confidence * 100 : 50,
          confidence_level: pick.recommendation === 'PICK' ? 'high' : pick.recommendation === 'caution' ? 'medium' : 'low',
          signals: pick.detected_signals || [],
          status: pick.outcome_verified ? (pick.outcome_correct ? 'won' : 'lost') : 'pending',
          event_id: pick.event_id,
          game_time: pick.commence_time,
          created_at: pick.detected_at,
        });
      }
    }

    // 2. God Mode Upset Predictions
    if (!engine || engine === 'godmode') {
      const { data: upsetPicks } = await supabase
        .from('god_mode_upset_predictions')
        .select('*')
        .gte('created_at', todayStart)
        .order('created_at', { ascending: false })
        .limit(50);

      for (const pick of upsetPicks || []) {
        if (sport && normalizeSport(pick.sport) !== sport) continue;
        
        allPicks.push({
          id: pick.id,
          engine_name: 'God Mode',
          sport: normalizeSport(pick.sport),
          pick_description: `${pick.underdog} ML (upset ${pick.favorite})`,
          team_name: pick.underdog,
          odds: pick.underdog_odds,
          confidence: pick.final_upset_score,
          confidence_level: pick.confidence,
          signals: pick.signals || [],
          status: pick.game_completed ? (pick.was_upset ? 'won' : 'lost') : 'pending',
          event_id: pick.event_id,
          game_time: pick.commence_time,
          created_at: pick.created_at,
        });
      }
    }

    // 3. Juiced Props
    if (!engine || engine === 'juiced') {
      const { data: juicedPicks } = await supabase
        .from('juiced_props')
        .select('*')
        .not('final_pick', 'is', null)
        .gte('created_at', todayStart)
        .order('created_at', { ascending: false })
        .limit(50);

      for (const pick of juicedPicks || []) {
        if (sport && normalizeSport(pick.sport) !== sport) continue;
        
        allPicks.push({
          id: pick.id,
          engine_name: 'Juiced Props',
          sport: normalizeSport(pick.sport),
          pick_description: `${pick.player_name} ${pick.final_pick} ${pick.line} ${pick.prop_type}`,
          player_name: pick.player_name,
          prop_type: pick.prop_type,
          line: pick.line,
          side: pick.final_pick,
          odds: pick.juice_direction === 'over' ? pick.over_price : pick.under_price,
          confidence: pick.final_pick_confidence ? pick.final_pick_confidence * 100 : 60,
          confidence_level: pick.juice_level === 'extreme' ? 'high' : pick.juice_level === 'heavy' ? 'medium' : 'low',
          signals: [],
          status: pick.outcome === 'won' ? 'won' : pick.outcome === 'lost' ? 'lost' : 'pending',
          event_id: pick.event_id,
          game_time: pick.commence_time,
          created_at: pick.created_at || new Date().toISOString(),
        });
      }
    }

    // 4. HitRate Parlays
    if (!engine || engine === 'hitrate') {
      const { data: hitratePicks } = await supabase
        .from('hitrate_parlays')
        .select('*')
        .gte('created_at', todayStart)
        .order('created_at', { ascending: false })
        .limit(20);

      for (const parlay of hitratePicks || []) {
        const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
        if (legs.length === 0) continue;
        
        const firstLeg = legs[0] as any;
        const parlayDesc = legs.slice(0, 3).map((l: any) => `${l.player_name || l.team} ${l.pick || l.description}`).join(' + ');
        
        allPicks.push({
          id: parlay.id,
          engine_name: 'HitRate',
          sport: normalizeSport(parlay.sport || firstLeg?.sport || 'mixed'),
          pick_description: parlayDesc + (legs.length > 3 ? ` (+${legs.length - 3} more)` : ''),
          odds: parlay.total_odds,
          confidence: parlay.combined_probability * 100,
          confidence_level: parlay.combined_probability >= 0.7 ? 'high' : parlay.combined_probability >= 0.5 ? 'medium' : 'low',
          signals: [],
          status: parlay.outcome === 'won' ? 'won' : parlay.outcome === 'lost' ? 'lost' : 'pending',
          game_time: parlay.expires_at,
          created_at: parlay.created_at,
        });
      }
    }

    // 5. AI Generated Parlays
    if (!engine || engine === 'ai') {
      const { data: aiPicks } = await supabase
        .from('ai_generated_parlays')
        .select('*')
        .gte('created_at', todayStart)
        .order('created_at', { ascending: false })
        .limit(20);

      for (const parlay of aiPicks || []) {
        const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
        if (legs.length === 0) continue;
        
        const parlayDesc = legs.slice(0, 3).map((l: any) => l.description || l.pick).join(' + ');
        
        allPicks.push({
          id: parlay.id,
          engine_name: 'AI Parlay',
          sport: normalizeSport(parlay.sport || 'mixed'),
          pick_description: parlayDesc + (legs.length > 3 ? ` (+${legs.length - 3} more)` : ''),
          odds: parlay.total_odds,
          confidence: parlay.confidence_score * 100,
          confidence_level: parlay.confidence_score >= 0.7 ? 'high' : parlay.confidence_score >= 0.5 ? 'medium' : 'low',
          signals: parlay.signals_used || [],
          status: parlay.outcome === 'won' ? 'won' : parlay.outcome === 'lost' ? 'lost' : 'pending',
          created_at: parlay.created_at,
        });
      }
    }

    // 6. Fatigue Edge
    if (!engine || engine === 'fatigue') {
      const { data: fatiguePicks } = await supabase
        .from('fatigue_edge_tracking')
        .select('*')
        .gte('created_at', todayStart)
        .order('created_at', { ascending: false })
        .limit(30);

      for (const pick of fatiguePicks || []) {
        allPicks.push({
          id: pick.id,
          engine_name: 'Fatigue Edge',
          sport: 'NBA',
          pick_description: `${pick.recommended_side} ${pick.recommended_angle || 'spread'} (${pick.fatigue_differential}pt fatigue diff)`,
          team_name: pick.recommended_side,
          confidence: Math.min(100, pick.fatigue_differential * 3),
          confidence_level: pick.fatigue_differential >= 25 ? 'high' : pick.fatigue_differential >= 15 ? 'medium' : 'low',
          signals: [],
          status: pick.recommended_side_won === true ? 'won' : pick.recommended_side_won === false ? 'lost' : 'pending',
          event_id: pick.event_id,
          created_at: pick.created_at,
        });
      }
    }

    // 7. FanDuel Traps
    if (!engine || engine === 'fanduel') {
      const { data: trapPicks } = await supabase
        .from('fanduel_trap_analysis')
        .select('*')
        .not('fade_the_public_pick', 'is', null)
        .gte('created_at', todayStart)
        .order('created_at', { ascending: false })
        .limit(30);

      for (const pick of trapPicks || []) {
        if (sport && normalizeSport(pick.sport) !== sport) continue;
        
        allPicks.push({
          id: pick.id,
          engine_name: 'FanDuel Trap',
          sport: normalizeSport(pick.sport),
          pick_description: pick.fade_the_public_pick || pick.description,
          player_name: pick.player_name,
          prop_type: pick.market_type,
          odds: pick.odds_for_fade,
          confidence: pick.trap_score || 50,
          confidence_level: (pick.trap_score || 0) >= 70 ? 'high' : (pick.trap_score || 0) >= 50 ? 'medium' : 'low',
          signals: pick.signals_detected || [],
          status: pick.fade_won === true ? 'won' : pick.fade_won === false ? 'lost' : 'pending',
          event_id: pick.event_id,
          game_time: pick.commence_time,
          created_at: pick.created_at || new Date().toISOString(),
        });
      }
    }

    // 8. Unified Props (Best Bets)
    if (!engine || engine === 'unified') {
      const { data: unifiedPicks } = await supabase
        .from('unified_props')
        .select('*')
        .eq('is_active', true)
        .gte('created_at', todayStart)
        .order('composite_score', { ascending: false })
        .limit(30);

      for (const pick of unifiedPicks || []) {
        if (sport && normalizeSport(pick.sport) !== sport) continue;
        
        allPicks.push({
          id: pick.id,
          engine_name: 'Unified Props',
          sport: normalizeSport(pick.sport),
          pick_description: `${pick.player_name} ${pick.recommendation || 'pick'} ${pick.line} ${pick.prop_type}`,
          player_name: pick.player_name,
          prop_type: pick.prop_type,
          line: pick.line,
          side: pick.recommendation,
          odds: pick.odds,
          confidence: pick.composite_score,
          confidence_level: pick.pvs_tier === 'elite' || pick.pvs_tier === 'premium' ? 'high' : pick.pvs_tier === 'solid' ? 'medium' : 'low',
          signals: [],
          status: pick.outcome === 'won' ? 'won' : pick.outcome === 'lost' ? 'lost' : 'pending',
          event_id: pick.event_id,
          game_time: pick.commence_time,
          created_at: pick.created_at,
        });
      }
    }

    // Sort by created_at descending
    allPicks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    // Sync to engine_live_tracker if requested
    if (syncToTracker && allPicks.length > 0) {
      console.log(`[Unified Live Feed] Syncing ${allPicks.length} picks to engine_live_tracker...`);
      
      const trackerRecords = allPicks.map(pick => ({
        id: pick.id,
        engine_name: pick.engine_name,
        sport: pick.sport,
        pick_description: pick.pick_description,
        player_name: pick.player_name,
        team_name: pick.team_name,
        prop_type: pick.prop_type,
        line: pick.line,
        side: pick.side,
        odds: pick.odds,
        confidence: pick.confidence,
        confidence_level: pick.confidence_level,
        signals: pick.signals,
        status: pick.status,
        event_id: pick.event_id,
        game_time: pick.game_time,
        created_at: pick.created_at,
      }));

      const { error: syncError } = await supabase
        .from('engine_live_tracker')
        .upsert(trackerRecords, { 
          onConflict: 'id',
          ignoreDuplicates: false 
        });

      if (syncError) {
        console.error('[Unified Live Feed] Sync error:', syncError);
      } else {
        console.log(`[Unified Live Feed] Synced ${trackerRecords.length} records`);
      }
    }

    // Calculate performance stats
    const performanceByEngine: Record<string, { total: number; won: number; lost: number; pending: number }> = {};
    
    for (const pick of allPicks) {
      if (!performanceByEngine[pick.engine_name]) {
        performanceByEngine[pick.engine_name] = { total: 0, won: 0, lost: 0, pending: 0 };
      }
      performanceByEngine[pick.engine_name].total++;
      if (pick.status === 'won') performanceByEngine[pick.engine_name].won++;
      else if (pick.status === 'lost') performanceByEngine[pick.engine_name].lost++;
      else performanceByEngine[pick.engine_name].pending++;
    }

    const duration = Date.now() - startTime;
    console.log(`[Unified Live Feed] Aggregated ${allPicks.length} picks in ${duration}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        totalPicks: allPicks.length,
        picks: allPicks.slice(0, 100),
        performance: performanceByEngine,
        duration,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Unified Live Feed] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

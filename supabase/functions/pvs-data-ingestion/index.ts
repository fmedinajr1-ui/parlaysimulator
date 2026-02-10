import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// EST-aware date helper
function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

// NBA Teams with their defensive and pace ratings (2024-25 approximations)
const NBA_TEAM_STATS = {
  "Boston Celtics": [106.5, 2, 101.2, 12, 108.2, 42.1, 24.5, 12.8, 4.2],
  "Oklahoma City Thunder": [107.2, 3, 99.8, 18, 109.5, 43.2, 23.8, 13.1, 5.1],
  "Cleveland Cavaliers": [108.1, 5, 98.5, 22, 110.2, 41.8, 24.1, 12.5, 4.8],
  "New York Knicks": [109.2, 8, 97.2, 25, 111.5, 44.2, 22.8, 11.9, 4.5],
  "Orlando Magic": [107.8, 4, 96.8, 27, 109.8, 43.5, 21.5, 12.2, 5.8],
  "Milwaukee Bucks": [110.5, 12, 100.5, 15, 112.8, 42.8, 25.2, 13.5, 4.1],
  "Miami Heat": [109.8, 10, 97.8, 24, 111.2, 41.2, 23.2, 12.8, 3.9],
  "Philadelphia 76ers": [111.2, 15, 98.2, 23, 113.5, 43.8, 24.8, 13.2, 4.3],
  "Indiana Pacers": [114.5, 25, 104.8, 1, 116.2, 44.5, 27.5, 14.8, 3.5],
  "Chicago Bulls": [112.8, 20, 98.8, 21, 114.5, 43.2, 24.2, 13.1, 3.8],
  "Atlanta Hawks": [115.2, 28, 102.5, 5, 117.8, 44.8, 26.8, 14.2, 3.2],
  "Brooklyn Nets": [113.5, 22, 100.2, 16, 115.2, 43.5, 25.5, 13.8, 3.6],
  "Toronto Raptors": [114.2, 24, 99.5, 19, 116.5, 44.2, 25.2, 14.1, 4.0],
  "Charlotte Hornets": [116.5, 29, 101.8, 8, 118.5, 45.2, 26.2, 14.5, 3.4],
  "Washington Wizards": [118.2, 30, 102.2, 6, 120.5, 46.1, 27.8, 15.2, 3.1],
  "Detroit Pistons": [115.8, 27, 99.2, 20, 117.2, 44.5, 25.8, 14.2, 4.2],
  "Denver Nuggets": [110.8, 13, 100.8, 14, 112.5, 42.5, 26.2, 12.8, 4.5],
  "Minnesota Timberwolves": [106.2, 1, 98.5, 22, 107.8, 40.5, 22.5, 11.8, 6.2],
  "Los Angeles Clippers": [109.5, 9, 99.2, 20, 111.8, 42.8, 24.5, 12.5, 4.1],
  "Dallas Mavericks": [111.8, 16, 99.8, 18, 113.2, 43.5, 25.8, 13.5, 3.8],
  "Phoenix Suns": [112.2, 18, 100.2, 16, 114.8, 43.2, 26.5, 13.8, 3.5],
  "Sacramento Kings": [113.2, 21, 103.5, 3, 115.5, 44.2, 27.2, 14.5, 3.2],
  "Los Angeles Lakers": [110.2, 11, 101.5, 10, 112.2, 42.2, 25.5, 12.5, 4.8],
  "Golden State Warriors": [111.5, 14, 101.2, 12, 113.8, 43.8, 26.8, 13.2, 4.2],
  "Houston Rockets": [108.5, 6, 101.8, 8, 110.5, 44.8, 23.5, 13.5, 5.5],
  "Memphis Grizzlies": [108.8, 7, 102.8, 4, 111.2, 45.5, 24.2, 12.8, 5.2],
  "New Orleans Pelicans": [112.5, 19, 100.5, 15, 114.2, 44.5, 25.2, 13.8, 4.8],
  "San Antonio Spurs": [114.8, 26, 103.2, 3, 116.8, 45.8, 26.5, 14.8, 3.8],
  "Utah Jazz": [115.5, 28, 101.2, 12, 117.5, 45.2, 26.8, 14.5, 3.5],
  "Portland Trail Blazers": [116.2, 29, 100.8, 14, 118.2, 44.8, 27.2, 15.1, 3.2],
};

// Fallback player templates for mock data
const POSITION_TEMPLATES: Record<string, Record<string, number>> = {
  GUARD: { points: 18.5, rebounds: 4.2, assists: 6.5, threes: 2.8, blocks: 0.4, steals: 1.2, minutes: 32.5 },
  FORWARD: { points: 16.8, rebounds: 6.5, assists: 3.2, threes: 1.5, blocks: 0.7, steals: 1.0, minutes: 30.5 },
  CENTER: { points: 13.5, rebounds: 10.2, assists: 2.0, threes: 0.3, blocks: 1.5, steals: 0.8, minutes: 28.5 },
  SWING: { points: 15.5, rebounds: 5.0, assists: 3.5, threes: 1.8, blocks: 0.5, steals: 1.0, minutes: 28.0 },
};

function getPlayerTemplate(playerName: string): Record<string, number> {
  // Simple heuristic based on common name patterns
  const name = playerName.toLowerCase();
  
  // Known star players override
  if (name.includes('jokic') || name.includes('embiid') || name.includes('gobert') || 
      name.includes('adebayo') || name.includes('towns') || name.includes('sabonis')) {
    return POSITION_TEMPLATES.CENTER;
  }
  
  if (name.includes('curry') || name.includes('young') || name.includes('morant') ||
      name.includes('lillard') || name.includes('haliburton') || name.includes('fox') ||
      name.includes('mitchell') || name.includes('brunson') || name.includes('irving')) {
    return POSITION_TEMPLATES.GUARD;
  }
  
  if (name.includes('james') || name.includes('durant') || name.includes('tatum') ||
      name.includes('giannis') || name.includes('leonard') || name.includes('george') ||
      name.includes('siakam') || name.includes('randle')) {
    return POSITION_TEMPLATES.FORWARD;
  }
  
  // Default to swing player template for unknowns
  return POSITION_TEMPLATES.SWING;
}

async function tryLiveFetch(supabase: any): Promise<{ success: boolean; results?: any }> {
  try {
    console.log('[PVS Data Ingestion] Attempting live BDL API fetch...');
    
    const { data, error } = await supabase.functions.invoke('nba-stats-fetcher', {
      body: { mode: 'sync' },
    });
    
    if (error) {
      console.error('[PVS Data Ingestion] Live fetch failed:', error);
      return { success: false };
    }
    
    console.log('[PVS Data Ingestion] Live fetch results:', data);
    return { success: true, results: data };
  } catch (error) {
    console.error('[PVS Data Ingestion] Live fetch exception:', error);
    return { success: false };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { mode = 'all' } = await req.json().catch(() => ({}));
    
    const results: Record<string, any> = {};
    const startTime = Date.now();

    console.log(`[PVS Data Ingestion] Starting with mode: ${mode}`);

    // NEW: Try live BDL API first if mode is 'live' or 'all'
    if (mode === 'live' || mode === 'all') {
      const liveResult = await tryLiveFetch(supabase);
      
      if (liveResult.success) {
        results.liveData = liveResult.results;
        console.log('[PVS Data Ingestion] Live data fetched successfully');
        
        // If live mode only, return early
        if (mode === 'live') {
          const duration = Date.now() - startTime;
          
          await supabase.from('cron_job_history').insert({
            job_name: 'pvs-data-ingestion',
            status: 'completed',
            started_at: new Date(startTime).toISOString(),
            completed_at: new Date().toISOString(),
            duration_ms: duration,
            result: { ...results, mode: 'live' },
          });
          
          return new Response(JSON.stringify({
            success: true,
            duration,
            results: { ...results, mode: 'live' },
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } else {
        console.log('[PVS Data Ingestion] Live fetch failed, falling back to mock data');
        results.liveDataFailed = true;
      }
    }

    // 1. Ingest opponent defense stats
    if (mode === 'all' || mode === 'defense') {
      console.log('[PVS Data Ingestion] Ingesting opponent defense stats...');
      const defenseRecords = [];
      
      for (const [teamName, stats] of Object.entries(NBA_TEAM_STATS)) {
        defenseRecords.push({
          team_name: teamName,
          stat_category: 'overall',
          defense_rating: stats[0],
          defense_rank: stats[1],
          points_allowed_avg: stats[4],
          rebounds_allowed_avg: stats[5],
          assists_allowed_avg: stats[6],
          threes_allowed_avg: stats[7],
          blocks_allowed_avg: stats[8],
        });
      }

      const { error: defenseError } = await supabase
        .from('nba_opponent_defense_stats')
        .upsert(defenseRecords, { onConflict: 'team_name,stat_category' });

      if (defenseError) {
        console.error('[PVS Data Ingestion] Defense stats error:', defenseError);
        results.defense = { error: defenseError.message };
      } else {
        results.defense = { inserted: defenseRecords.length };
      }
    }

    // 2. Ingest team pace projections
    if (mode === 'all' || mode === 'pace') {
      console.log('[PVS Data Ingestion] Ingesting team pace projections...');
      const paceRecords = [];
      
      for (const [teamName, stats] of Object.entries(NBA_TEAM_STATS)) {
        paceRecords.push({
          team_name: teamName,
          pace_rating: stats[2],
          pace_rank: stats[3],
          possessions_per_game: stats[2] * 0.97 + 2,
          tempo_factor: stats[2] / 100,
        });
      }

      const { error: paceError } = await supabase
        .from('nba_team_pace_projections')
        .upsert(paceRecords, { onConflict: 'team_name' });

      if (paceError) {
        console.error('[PVS Data Ingestion] Pace stats error:', paceError);
        results.pace = { error: paceError.message };
      } else {
        results.pace = { inserted: paceRecords.length };
      }
    }

    // 3. Generate game logs for players from unified_props (dynamic seeding)
    if (mode === 'all' || mode === 'gamelogs' || mode === 'sync_players') {
      console.log('[PVS Data Ingestion] Generating player game logs...');
      
      // Get unique player names from unified_props
      const { data: propsData, error: propsError } = await supabase
        .from('unified_props')
        .select('player_name')
        .eq('sport', 'basketball_nba')
        .gte('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());
      
      const playerNames: string[] = propsData 
        ? [...new Set(propsData.map(p => p.player_name))]
        : [];
      
      console.log(`[PVS Data Ingestion] Found ${playerNames.length} unique players from props`);
      
      const gameLogRecords = [];
      const teams = Object.keys(NBA_TEAM_STATS);
      
      for (const playerName of playerNames) {
        const template = getPlayerTemplate(playerName);
        
        // Generate 10 game logs for each player with unique dates
        for (let i = 0; i < 10; i++) {
          const gameDate = new Date();
          gameDate.setDate(gameDate.getDate() - (i * 2 + 1)); // Unique date per game
          
          const opponent = teams[Math.floor(Math.random() * teams.length)];
          const variance = () => 0.7 + Math.random() * 0.6; // 70%-130% of average
          
          gameLogRecords.push({
            player_name: playerName,
            game_date: gameDate.toISOString().split('T')[0],
            opponent: opponent,
            is_home: Math.random() > 0.5,
            points: Math.round(template.points * variance()),
            rebounds: Math.round(template.rebounds * variance()),
            assists: Math.round(template.assists * variance()),
            threes_made: Math.max(0, Math.round(template.threes * variance())),
            blocks: Math.max(0, Math.round(template.blocks * variance() * 2) / 2),
            steals: Math.max(0, Math.round(template.steals * variance() * 2) / 2),
            turnovers: Math.round(2 + Math.random() * 3),
            minutes_played: Math.round(template.minutes * (0.85 + Math.random() * 0.3)),
          });
        }
      }

      if (gameLogRecords.length > 0) {
        const { error: gameLogError } = await supabase
          .from('nba_player_game_logs')
          .upsert(gameLogRecords, { 
            onConflict: 'player_name,game_date',
            ignoreDuplicates: false 
          });

        if (gameLogError) {
          console.error('[PVS Data Ingestion] Game logs error:', gameLogError);
          results.gamelogs = { error: gameLogError.message };
        } else {
          results.gamelogs = { inserted: gameLogRecords.length, players: playerNames.length };
        }
      } else {
        results.gamelogs = { inserted: 0, message: 'No players found in unified_props' };
      }
    }

    // 4. Generate sample injury reports
    if (mode === 'all' || mode === 'injuries') {
      console.log('[PVS Data Ingestion] Generating injury reports...');
      const today = getEasternDate();
      
      // Delete existing injury reports for today
      await supabase
        .from('nba_injury_reports')
        .delete()
        .eq('game_date', today);
      
      const injuryRecords = [
        { player_name: "Joel Embiid", team_name: "Philadelphia 76ers", status: "Out", injury_type: "Knee", impact_level: "high", affects_rotation: true, game_date: today },
        { player_name: "Kawhi Leonard", team_name: "Los Angeles Clippers", status: "Day-To-Day", injury_type: "Load Management", impact_level: "medium", affects_rotation: true, game_date: today },
        { player_name: "Zion Williamson", team_name: "New Orleans Pelicans", status: "Out", injury_type: "Hamstring", impact_level: "high", affects_rotation: true, game_date: today },
        { player_name: "Ja Morant", team_name: "Memphis Grizzlies", status: "Questionable", injury_type: "Shoulder", impact_level: "high", affects_rotation: true, game_date: today },
        { player_name: "Paolo Banchero", team_name: "Orlando Magic", status: "Out", injury_type: "Oblique", impact_level: "high", affects_rotation: true, game_date: today },
      ];

      const { error: injuryError } = await supabase
        .from('nba_injury_reports')
        .insert(injuryRecords);

      if (injuryError) {
        console.error('[PVS Data Ingestion] Injury reports error:', injuryError);
        results.injuries = { error: injuryError.message };
      } else {
        results.injuries = { inserted: injuryRecords.length };
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[PVS Data Ingestion] Completed in ${duration}ms`, results);

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'pvs-data-ingestion',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: results,
    });

    return new Response(JSON.stringify({
      success: true,
      duration,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PVS Data Ingestion] Fatal error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

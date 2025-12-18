import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UsageProjection {
  playerName: string;
  propType: string;
  line: number;
  projectedMinutes: { min: number; max: number; avg: number };
  requiredRate: number;
  historicalRate: number;
  efficiencyMargin: number;
  recentGames: { date: string; value: number; minutes: number }[];
  hitRate: { hits: number; total: number; percentage: number };
  paceImpact: number;
  fatigueImpact: number;
  opponentDefenseRank: number | null;
  verdict: 'FAVORABLE' | 'NEUTRAL' | 'UNFAVORABLE';
  verdictReason: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { playerName, propType, line, opponent, gameDate, sport } = await req.json();

    if (!playerName || !propType || line === undefined) {
      return new Response(
        JSON.stringify({ error: 'Missing required parameters: playerName, propType, line' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Detect sport from propType if not provided
    const normalizedSport = (sport || 'NBA').toUpperCase();
    console.log(`Calculating usage for ${playerName} - ${propType} ${line} (${normalizedSport})`);

    // Sport-specific table mapping
    const tableMap: Record<string, string> = {
      'NBA': 'nba_player_game_logs',
      'NFL': 'nfl_player_game_logs',
      'NHL': 'nhl_player_game_logs',
      'MLB': 'mlb_player_game_logs'
    };
    const tableName = tableMap[normalizedSport] || 'nba_player_game_logs';

    // Sport-specific prop type mappings
    const nbaPropTypeMap: Record<string, string> = {
      'points': 'points', 'rebounds': 'rebounds', 'assists': 'assists',
      'threes': 'threes_made', 'blocks': 'blocks', 'steals': 'steals',
      'pts': 'points', 'reb': 'rebounds', 'ast': 'assists',
      'pts+reb': 'points,rebounds', 'pts+ast': 'points,assists',
      'pts+reb+ast': 'points,rebounds,assists',
    };
    
    const nflPropTypeMap: Record<string, string> = {
      'passing_yards': 'passing_yards', 'rushing_yards': 'rushing_yards',
      'receiving_yards': 'receiving_yards', 'receptions': 'receptions',
      'touchdowns': 'touchdowns', 'completions': 'completions',
      'pass_yards': 'passing_yards', 'rush_yards': 'rushing_yards',
      'rec_yards': 'receiving_yards', 'tds': 'touchdowns',
    };
    
    const nhlPropTypeMap: Record<string, string> = {
      'goals': 'goals', 'assists': 'assists', 'points': 'points',
      'shots': 'shots_on_goal', 'saves': 'saves', 'blocks': 'blocked_shots',
    };
    
    const mlbPropTypeMap: Record<string, string> = {
      'hits': 'hits', 'runs': 'runs', 'rbis': 'rbis', 'rbi': 'rbis',
      'strikeouts': 'strikeouts', 'home_runs': 'home_runs', 'hr': 'home_runs',
      'total_bases': 'total_bases', 'stolen_bases': 'stolen_bases',
    };

    const propTypeMaps: Record<string, Record<string, string>> = {
      'NBA': nbaPropTypeMap, 'NFL': nflPropTypeMap,
      'NHL': nhlPropTypeMap, 'MLB': mlbPropTypeMap
    };
    
    const propTypeMap = propTypeMaps[normalizedSport] || nbaPropTypeMap;
    const statColumn = propTypeMap[propType.toLowerCase()] || propType.toLowerCase();
    const isCombo = statColumn.includes(',');

    // Fetch recent game logs from sport-specific table
    const { data: gameLogs, error: logsError } = await supabase
      .from(tableName)
      .select('*')
      .ilike('player_name', `%${playerName}%`)
      .order('game_date', { ascending: false })
      .limit(10);

    if (logsError) {
      console.error(`Error fetching game logs from ${tableName}:`, logsError);
    }

    // Calculate usage metrics from game logs
    let avgMinutes = normalizedSport === 'NBA' ? 32 : normalizedSport === 'NFL' ? 60 : 20;
    let avgStat = 0;
    let statPerMin: number | null = null;
    let recentGames: { date: string; value: number; minutes: number }[] = [];
    let hitCount = 0;
    let gamesAnalyzed = 0;
    let dataAvailable = true;

    if (gameLogs && gameLogs.length > 0) {
      gamesAnalyzed = gameLogs.length;
      
      // Calculate averages
      let totalMinutes = 0;
      let totalStat = 0;
      let hasMinutesData = false;

      for (const game of gameLogs) {
        // Different sports have different minute columns
        const minutes = game.minutes_played || game.snaps || game.time_on_ice || game.innings_pitched || 0;
        if (minutes > 0) hasMinutesData = true;
        
        let statValue = 0;
        if (isCombo) {
          const cols = statColumn.split(',');
          for (const col of cols) {
            statValue += game[col] || 0;
          }
        } else {
          statValue = game[statColumn] || 0;
        }

        totalMinutes += minutes;
        totalStat += statValue;

        recentGames.push({
          date: game.game_date,
          value: statValue,
          minutes: minutes
        });

        if (statValue > line) {
          hitCount++;
        }
      }

      avgMinutes = hasMinutesData && totalMinutes > 0 ? totalMinutes / gamesAnalyzed : avgMinutes;
      avgStat = totalStat / gamesAnalyzed;
      
      // Only calculate rate if we have valid minutes data
      if (hasMinutesData && totalMinutes > 0) {
        statPerMin = avgStat / avgMinutes;
      } else {
        statPerMin = null; // Explicitly null when minutes data unavailable
      }
    } else {
      // No game logs found
      dataAvailable = false;
      statPerMin = null;
    }

    // Calculate required rate to hit line
    const requiredRate = avgMinutes > 0 ? line / avgMinutes : 0;
    const efficiencyMargin = statPerMin !== null && statPerMin > 0 && requiredRate > 0
      ? ((statPerMin - requiredRate) / requiredRate) * 100 
      : 0;

    // Calculate minutes range
    const minutesArr = recentGames.map(g => g.minutes);
    const minMinutes = minutesArr.length > 0 ? Math.min(...minutesArr) : avgMinutes - 3;
    const maxMinutes = minutesArr.length > 0 ? Math.max(...minutesArr) : avgMinutes + 3;

    // Fetch opponent defense stats if provided
    let opponentDefenseRank: number | null = null;
    let defenseImpact = 0;

    if (opponent) {
      const { data: defenseStats } = await supabase
        .from('nba_opponent_defense_stats')
        .select('*')
        .ilike('team_name', `%${opponent}%`)
        .limit(1)
        .maybeSingle();

      if (defenseStats) {
        opponentDefenseRank = defenseStats.defense_rank;
        // Better defense = negative impact, worse defense = positive impact
        defenseImpact = (15 - defenseStats.defense_rank) * 0.5; // -7% to +7%
      }
    }

    // Fetch pace data for opponent
    let paceImpact = 0;
    if (opponent) {
      const { data: paceData } = await supabase
        .from('nba_team_pace_projections')
        .select('*')
        .ilike('team_name', `%${opponent}%`)
        .limit(1)
        .maybeSingle();

      if (paceData) {
        // Higher pace = more possessions = more opportunities
        paceImpact = (paceData.pace_rating - 100) * 0.1; // -3% to +3%
      }
    }

    // Check for fatigue
    let fatigueImpact = 0;
    if (gameDate) {
      const { data: fatigueData } = await supabase
        .from('nba_fatigue_scores')
        .select('*')
        .eq('game_date', gameDate)
        .ilike('team_name', `%${playerName.split(' ').pop()}%`)
        .limit(1)
        .maybeSingle();

      if (fatigueData) {
        // Convert fatigue score to impact percentage
        fatigueImpact = -fatigueData.fatigue_score * 0.2; // Higher fatigue = negative impact
      }
    }

    // Determine verdict
    let verdict: 'FAVORABLE' | 'NEUTRAL' | 'UNFAVORABLE' = 'NEUTRAL';
    let verdictReason = '';

    const hitPercentage = gamesAnalyzed > 0 ? (hitCount / gamesAnalyzed) * 100 : 50;
    const adjustedEfficiency = efficiencyMargin + paceImpact + fatigueImpact + defenseImpact;

    if (!dataAvailable || gamesAnalyzed === 0) {
      verdict = 'NEUTRAL';
      verdictReason = `Insufficient historical data for ${playerName} in ${normalizedSport}`;
    } else if (hitPercentage >= 70 && adjustedEfficiency >= 5) {
      verdict = 'FAVORABLE';
      verdictReason = `Strong historical hit rate (${hitPercentage.toFixed(0)}%) with ${adjustedEfficiency.toFixed(1)}% efficiency buffer`;
    } else if (hitPercentage <= 40 || adjustedEfficiency < -10) {
      verdict = 'UNFAVORABLE';
      verdictReason = hitPercentage <= 40 
        ? `Low historical hit rate (${hitPercentage.toFixed(0)}%) at this line`
        : `Insufficient usage opportunity (${adjustedEfficiency.toFixed(1)}% efficiency gap)`;
    } else {
      verdict = 'NEUTRAL';
      verdictReason = `Marginal edge (${hitPercentage.toFixed(0)}% hit rate, ${adjustedEfficiency.toFixed(1)}% efficiency)`;
    }

    const projection: UsageProjection & { dataAvailable: boolean } = {
      playerName,
      propType,
      line,
      projectedMinutes: { 
        min: Math.round(minMinutes), 
        max: Math.round(maxMinutes), 
        avg: Math.round(avgMinutes * 10) / 10 
      },
      requiredRate: Math.round(requiredRate * 1000) / 1000,
      historicalRate: statPerMin !== null ? Math.round(statPerMin * 1000) / 1000 : null as any,
      efficiencyMargin: Math.round(efficiencyMargin * 10) / 10,
      recentGames: recentGames.slice(0, 5),
      hitRate: { 
        hits: hitCount, 
        total: gamesAnalyzed, 
        percentage: Math.round(hitPercentage) 
      },
      paceImpact: Math.round(paceImpact * 10) / 10,
      fatigueImpact: Math.round(fatigueImpact * 10) / 10,
      opponentDefenseRank,
      verdict,
      verdictReason,
      dataAvailable
    };

    // Cache the usage metrics
    const { error: cacheError } = await supabase
      .from('player_usage_metrics')
      .upsert({
        player_name: playerName,
        sport: 'basketball_nba',
        avg_minutes: avgMinutes,
        avg_points: propType.toLowerCase().includes('point') ? avgStat : 0,
        avg_rebounds: propType.toLowerCase().includes('reb') ? avgStat : 0,
        avg_assists: propType.toLowerCase().includes('ast') ? avgStat : 0,
        pts_per_min: statPerMin,
        games_analyzed: gamesAnalyzed,
        usage_trend: efficiencyMargin > 5 ? 'increasing' : efficiencyMargin < -5 ? 'decreasing' : 'stable',
        recent_game_logs: recentGames,
        calculated_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'player_name,sport' });

    if (cacheError) {
      console.error('Error caching usage metrics:', cacheError);
    }

    console.log(`Usage projection for ${playerName}: ${verdict}`);

    return new Response(
      JSON.stringify(projection),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error calculating player usage:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

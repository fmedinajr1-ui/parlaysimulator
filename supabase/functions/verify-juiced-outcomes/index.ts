import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface JuicedProp {
  id: string;
  player_name: string;
  prop_type: string;
  line: number;
  final_pick: string;
  sport: string;
  event_id: string;
  commence_time: string;
  juice_level: string;
  juice_direction: string;
  over_price?: number;
  under_price?: number;
}

interface FailedLookup {
  player: string;
  prop_type: string;
  sport: string;
  date: string;
  reason: string;
}

// Normalized prop type mapping (all lowercase keys for case-insensitive lookup)
const PROP_TO_STAT_MAP: Record<string, string> = {
  // NBA props
  'points': 'points',
  'rebounds': 'rebounds',
  'assists': 'assists',
  '3-pointers': 'threes_made',
  'threes': 'threes_made',
  'blocks': 'blocks',
  'steals': 'steals',
  'turnovers': 'turnovers',
  'pts+reb+ast': 'pra',
  'pts+reb': 'pr',
  'pts+ast': 'pa',
  'reb+ast': 'ra',
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threes_made',
  'player_blocks': 'blocks',
  'player_steals': 'steals',
  'player_turnovers': 'turnovers',
  'player_points_rebounds_assists': 'pra',
  'player_points_rebounds': 'pr',
  'player_points_assists': 'pa',
  'player_rebounds_assists': 'ra',
  
  // NFL props
  'rush yards': 'rush_yards',
  'rushing yards': 'rush_yards',
  'pass tds': 'pass_tds',
  'passing tds': 'pass_tds',
  'passing touchdowns': 'pass_tds',
  'pass yards': 'pass_yards',
  'passing yards': 'pass_yards',
  'receiving yards': 'receiving_yards',
  'receptions': 'receptions',
  'rec yards': 'receiving_yards',
  'rush tds': 'rush_tds',
  'rushing tds': 'rush_tds',
  'rushing touchdowns': 'rush_tds',
  'receiving tds': 'receiving_tds',
  'interceptions': 'interceptions',
  'completions': 'completions',
  'pass attempts': 'pass_attempts',
  'rush attempts': 'rush_attempts',
  'carries': 'rush_attempts',
  'targets': 'targets',
  
  // NHL props
  'goals': 'goals',
  'assists_nhl': 'assists',
  'shots on goal': 'shots_on_goal',
  'shots': 'shots_on_goal',
  'saves': 'saves',
  'power play points': 'power_play_points',
  'blocked shots': 'blocked_shots',
  'hits': 'hits',
  'faceoffs won': 'faceoffs_won',
  'goalie saves': 'saves',
  'goals against': 'goals_against',
  
  // MLB props
  'hits_mlb': 'hits',
  'home runs': 'home_runs',
  'rbis': 'rbis',
  'runs': 'runs_scored',
  'strikeouts': 'strikeouts',
  'total bases': 'total_bases',
  'walks': 'walks',
  'stolen bases': 'stolen_bases',
  'pitcher strikeouts': 'pitcher_strikeouts',
  'earned runs': 'earned_runs',
  'hits allowed': 'hits_allowed',
};

// Sport to game logs table mapping
const SPORT_GAME_LOGS: Record<string, string> = {
  'basketball_nba': 'nba_player_game_logs',
  'nba': 'nba_player_game_logs',
  'americanfootball_nfl': 'nfl_player_game_logs',
  'nfl': 'nfl_player_game_logs',
  'americanfootball_ncaaf': 'nfl_player_game_logs',
  'ncaaf': 'nfl_player_game_logs',
  'icehockey_nhl': 'nhl_player_game_logs',
  'nhl': 'nhl_player_game_logs',
};

// Normalize prop type for case-insensitive, trimmed lookup
function normalizePropType(propType: string): string {
  return propType.trim().toLowerCase();
}

// Improved player name normalization
function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.\-''`]/g, ' ')  // Replace special chars with spaces
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, '')  // Remove suffixes
    .replace(/\s+/g, ' ')
    .trim();
}

// Create search pattern for player name matching
function createPlayerSearchPattern(normalizedName: string): string {
  const parts = normalizedName.split(' ').filter(p => p.length > 1);
  return parts.join('%');
}

// Convert American odds to decimal multiplier for ROI calculation
function oddsToMultiplier(odds: number): number {
  if (odds > 0) return odds / 100;  // +150 => 1.5 profit
  return 100 / Math.abs(odds);       // -110 => 0.909 profit
}

// Determine sport category from sport string
function getSportCategory(sport: string): string {
  const s = sport.toLowerCase();
  if (s.includes('nba') || s.includes('basketball')) return 'nba';
  if (s.includes('nfl') || s.includes('football') && !s.includes('soccer')) return 'nfl';
  if (s.includes('nhl') || s.includes('hockey')) return 'nhl';
  if (s.includes('mlb') || s.includes('baseball')) return 'mlb';
  return 'unknown';
}

// Extract stat value from NBA game log
function extractNBAStat(log: any, statType: string): number | null {
  switch (statType) {
    case 'points': return log.points;
    case 'rebounds': return log.rebounds;
    case 'assists': return log.assists;
    case 'threes_made': return log.threes_made;
    case 'blocks': return log.blocks;
    case 'steals': return log.steals;
    case 'turnovers': return log.turnovers;
    case 'pra': return (log.points || 0) + (log.rebounds || 0) + (log.assists || 0);
    case 'pr': return (log.points || 0) + (log.rebounds || 0);
    case 'pa': return (log.points || 0) + (log.assists || 0);
    case 'ra': return (log.rebounds || 0) + (log.assists || 0);
    default: return null;
  }
}

// Extract stat value from NFL game log
function extractNFLStat(log: any, statType: string): number | null {
  switch (statType) {
    case 'rush_yards': return log.rushing_yards ?? log.rush_yards;
    case 'pass_yards': return log.passing_yards ?? log.pass_yards;
    case 'pass_tds': return log.passing_tds ?? log.pass_tds;
    case 'receiving_yards': return log.receiving_yards ?? log.rec_yards;
    case 'receptions': return log.receptions ?? log.catches;
    case 'rush_tds': return log.rushing_tds ?? log.rush_tds;
    case 'receiving_tds': return log.receiving_tds ?? log.rec_tds;
    case 'interceptions': return log.interceptions;
    case 'completions': return log.completions;
    case 'pass_attempts': return log.pass_attempts ?? log.attempts;
    case 'rush_attempts': return log.rush_attempts ?? log.carries;
    case 'targets': return log.targets;
    default: return null;
  }
}

// Extract stat value from NHL game log
function extractNHLStat(log: any, statType: string): number | null {
  switch (statType) {
    case 'goals': return log.goals;
    case 'assists': return log.assists;
    case 'points': return (log.goals || 0) + (log.assists || 0);
    case 'shots_on_goal': return log.shots_on_goal ?? log.shots;
    case 'saves': return log.saves;
    case 'power_play_points': return log.power_play_points ?? log.pp_points;
    case 'blocked_shots': return log.blocked_shots ?? log.blocks;
    case 'hits': return log.hits;
    case 'faceoffs_won': return log.faceoffs_won ?? log.fow;
    case 'goals_against': return log.goals_against;
    default: return null;
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
    const startTime = Date.now();

    // Get juiced props that need verification
    const cutoffTime = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    
    const { data: pendingProps, error: fetchError } = await supabase
      .from('juiced_props')
      .select('*')
      .not('final_pick', 'is', null)
      .or('outcome.is.null,outcome.eq.pending')
      .is('verified_at', null)
      .lt('commence_time', new Date().toISOString())
      .gt('commence_time', cutoffTime)
      .order('commence_time', { ascending: true })
      .limit(150);

    if (fetchError) throw fetchError;

    console.log(`[VerifyJuiced] Found ${pendingProps?.length || 0} props to verify`);

    if (!pendingProps || pendingProps.length === 0) {
      return new Response(JSON.stringify({
        message: 'No juiced props to verify',
        verified: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let verifiedCount = 0;
    let wonCount = 0;
    let lostCount = 0;
    let pushCount = 0;
    const failedLookups: FailedLookup[] = [];
    const oddsForROI: number[] = [];
    const winsWithOdds: { odds: number }[] = [];

    // Process props in parallel chunks for performance
    const CHUNK_SIZE = 10;
    
    for (let i = 0; i < pendingProps.length; i += CHUNK_SIZE) {
      const chunk = pendingProps.slice(i, i + CHUNK_SIZE);
      
      await Promise.all(chunk.map(async (prop: JuicedProp) => {
        const normalizedPropType = normalizePropType(prop.prop_type);
        const statType = PROP_TO_STAT_MAP[normalizedPropType];
        
        if (!statType) {
          console.log(`[VerifyJuiced] Unknown prop type: "${prop.prop_type}" (normalized: "${normalizedPropType}") for ${prop.player_name}`);
          failedLookups.push({
            player: prop.player_name,
            prop_type: prop.prop_type,
            sport: prop.sport,
            date: prop.commence_time.split('T')[0],
            reason: 'unknown_prop_type'
          });
          return;
        }

        const normalizedName = normalizePlayerName(prop.player_name);
        const searchPattern = createPlayerSearchPattern(normalizedName);
        const sportCategory = getSportCategory(prop.sport);

        console.log(`[VerifyJuiced] Processing: ${prop.player_name} (${normalizedName}) - ${prop.prop_type} -> ${statType} [${sportCategory}]`);

        let actualValue: number | null = null;

        // Get game date range (±1 day to handle timezone differences)
        const gameDate = new Date(prop.commence_time);
        const targetMs = gameDate.getTime();
        const startDate = new Date(targetMs - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const endDate = new Date(targetMs + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const exactDate = gameDate.toISOString().split('T')[0];

        // Check player_stats_cache first (works for all sports)
        const { data: statsCache } = await supabase
          .from('player_stats_cache')
          .select('stat_value, player_name, game_date')
          .ilike('player_name', `%${searchPattern}%`)
          .eq('stat_type', statType)
          .gte('game_date', startDate)
          .lte('game_date', endDate);

        if (statsCache && statsCache.length > 0) {
          // Pick the closest game to commence_time
          if (statsCache.length === 1) {
            actualValue = statsCache[0].stat_value;
            console.log(`[VerifyJuiced] Found in player_stats_cache: ${statsCache[0].player_name} = ${actualValue}`);
          } else {
            // Multiple games found - pick closest
            const closest = statsCache.reduce((prev, curr) => {
              const prevDiff = Math.abs(new Date(prev.game_date).getTime() - targetMs);
              const currDiff = Math.abs(new Date(curr.game_date).getTime() - targetMs);
              return currDiff < prevDiff ? curr : prev;
            });
            actualValue = closest.stat_value;
            console.log(`[VerifyJuiced] Multiple games found, picked closest: ${closest.player_name} on ${closest.game_date} = ${actualValue}`);
          }
        }

        // Sport-specific game log fallbacks
        if (actualValue === null) {
          const gameLogsTable = SPORT_GAME_LOGS[sportCategory] || SPORT_GAME_LOGS[prop.sport.toLowerCase()];
          
          if (gameLogsTable) {
            const { data: allGames } = await supabase
              .from(gameLogsTable)
              .select('*')
              .ilike('player_name', `%${searchPattern}%`)
              .gte('game_date', startDate)
              .lte('game_date', endDate);

            if (allGames && allGames.length > 0) {
              // Pick the closest game to commence_time
              const closest = allGames.length === 1 ? allGames[0] : allGames.reduce((prev, curr) => {
                const prevDiff = Math.abs(new Date(prev.game_date).getTime() - targetMs);
                const currDiff = Math.abs(new Date(curr.game_date).getTime() - targetMs);
                return currDiff < prevDiff ? curr : prev;
              });

              console.log(`[VerifyJuiced] Found in ${gameLogsTable}: ${closest.player_name} on ${closest.game_date}`);
              
              // Extract stat based on sport
              if (sportCategory === 'nba') {
                actualValue = extractNBAStat(closest, statType);
              } else if (sportCategory === 'nfl') {
                actualValue = extractNFLStat(closest, statType);
              } else if (sportCategory === 'nhl') {
                actualValue = extractNHLStat(closest, statType);
              }
            }
          }
        }

        if (actualValue === null) {
          console.log(`[VerifyJuiced] No stats found for ${prop.player_name} - ${prop.prop_type} [${sportCategory}] (date: ${exactDate})`);
          failedLookups.push({
            player: prop.player_name,
            prop_type: prop.prop_type,
            sport: prop.sport,
            date: exactDate,
            reason: 'no_stats_found'
          });
          return;
        }

        // Determine outcome with full case-insensitive pick detection
        let outcome: 'won' | 'lost' | 'push';
        const pickLower = (prop.final_pick || '').toLowerCase().trim();
        
        if (actualValue === prop.line) {
          outcome = 'push';
          pushCount++;
        } else if (pickLower === 'over') {
          outcome = actualValue > prop.line ? 'won' : 'lost';
        } else if (pickLower === 'under') {
          outcome = actualValue < prop.line ? 'won' : 'lost';
        } else {
          console.warn(`[VerifyJuiced] Unknown pick type: "${prop.final_pick}" for ${prop.player_name}`);
          failedLookups.push({
            player: prop.player_name,
            prop_type: prop.prop_type,
            sport: prop.sport,
            date: exactDate,
            reason: `unknown_pick_type: ${prop.final_pick}`
          });
          return;
        }

        // Track odds for ROI calculation
        const betOdds = pickLower === 'over' 
          ? (prop.over_price || -110) 
          : (prop.under_price || -110);
        
        oddsForROI.push(betOdds);
        
        if (outcome === 'won') {
          wonCount++;
          winsWithOdds.push({ odds: betOdds });
        }
        if (outcome === 'lost') lostCount++;

        // Update the juiced prop
        const { error: updateError } = await supabase
          .from('juiced_props')
          .update({
            outcome,
            actual_value: actualValue,
            verified_at: new Date().toISOString()
          })
          .eq('id', prop.id);

        if (!updateError) {
          verifiedCount++;
          console.log(`[VerifyJuiced] ✅ Verified: ${prop.player_name} ${prop.prop_type} - Line: ${prop.line}, Actual: ${actualValue}, Pick: ${prop.final_pick}, Outcome: ${outcome}, Odds: ${betOdds}`);
        } else {
          console.error(`[VerifyJuiced] Update error for ${prop.id}:`, updateError);
        }
      }));
    }

    // Calculate accurate ROI using actual odds
    let totalROI = 0;
    if (verifiedCount > 0 && (verifiedCount - pushCount) > 0) {
      const totalProfit = winsWithOdds.reduce((sum, w) => sum + oddsToMultiplier(w.odds), 0) - lostCount;
      totalROI = (totalProfit / (verifiedCount - pushCount)) * 100;
    }

    // Update accuracy metrics with actual odds-based ROI
    const { data: accuracyData } = await supabase
      .from('juiced_props')
      .select('juice_level, juice_direction, prop_type, sport, outcome, over_price, under_price, final_pick')
      .not('outcome', 'eq', 'pending')
      .not('outcome', 'is', null);

    if (accuracyData && accuracyData.length > 0) {
      const groups: Record<string, any[]> = {};
      for (const row of accuracyData) {
        const key = `${row.juice_level}|${row.juice_direction}|${row.prop_type || 'all'}|${row.sport || 'all'}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(row);
      }

      for (const [key, rows] of Object.entries(groups)) {
        const [juice_level, juice_direction, prop_type, sport] = key.split('|');
        const total = rows.length;
        const won = rows.filter(r => r.outcome === 'won').length;
        const lost = rows.filter(r => r.outcome === 'lost').length;
        const push = rows.filter(r => r.outcome === 'push').length;
        const winRate = (total - push) > 0 ? (won / (total - push)) * 100 : 0;
        
        // Calculate ROI using actual odds
        let groupROI = 0;
        if ((total - push) > 0) {
          const groupProfit = rows
            .filter(r => r.outcome === 'won')
            .reduce((sum, r) => {
              const pickLower = (r.final_pick || '').toLowerCase();
              const odds = pickLower === 'over' ? (r.over_price || -110) : (r.under_price || -110);
              return sum + oddsToMultiplier(odds);
            }, 0) - lost;
          groupROI = (groupProfit / (total - push)) * 100;
        }

        await supabase.from('juiced_props_accuracy_metrics').upsert({
          juice_level,
          juice_direction,
          prop_type: prop_type === 'all' ? null : prop_type,
          sport: sport === 'all' ? null : sport,
          total_picks: total,
          total_won: won,
          total_lost: lost,
          total_push: push,
          win_rate: Math.round(winRate * 10) / 10,
          roi_percentage: Math.round(groupROI * 10) / 10,
          updated_at: new Date().toISOString()
        }, { onConflict: 'juice_level,juice_direction,prop_type,sport' });
      }
    }

    const duration = Date.now() - startTime;

    // Aggregate failed lookups by sport for summary
    const failedBySport = failedLookups.reduce((acc, f) => {
      const category = getSportCategory(f.sport);
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const failedByReason = failedLookups.reduce((acc, f) => {
      acc[f.reason] = (acc[f.reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Log to cron history with enhanced diagnostics
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-juiced-outcomes',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { 
        verified: verifiedCount, 
        won: wonCount,
        lost: lostCount,
        push: pushCount,
        notFound: failedLookups.length,
        winRate: (verifiedCount - pushCount) > 0 ? Math.round((wonCount / (verifiedCount - pushCount)) * 1000) / 10 : 0,
        roi: Math.round(totalROI * 10) / 10,
        failedBySport,
        failedByReason,
        failedLookups: failedLookups.slice(0, 20) // Top 20 for debugging
      }
    });

    console.log(`[VerifyJuiced] Summary: Verified=${verifiedCount}, Won=${wonCount}, Lost=${lostCount}, Push=${pushCount}, NotFound=${failedLookups.length}`);
    console.log(`[VerifyJuiced] Failed by sport: ${JSON.stringify(failedBySport)}`);
    console.log(`[VerifyJuiced] Failed by reason: ${JSON.stringify(failedByReason)}`);

    return new Response(JSON.stringify({
      message: `Verified ${verifiedCount} juiced props`,
      verified: verifiedCount,
      won: wonCount,
      lost: lostCount,
      push: pushCount,
      notFound: failedLookups.length,
      winRate: (verifiedCount - pushCount) > 0 ? Math.round((wonCount / (verifiedCount - pushCount)) * 1000) / 10 : 0,
      roi: Math.round(totalROI * 10) / 10,
      failedBySport,
      failedByReason,
      duration
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[VerifyJuiced] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

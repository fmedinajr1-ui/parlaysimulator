import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Zone types matching client-side
type ZoneType = 'restricted_area' | 'paint' | 'mid_range' | 'corner_3' | 'above_break_3';
type DefenseRating = 'elite' | 'good' | 'average' | 'poor' | 'bad';
type MatchupGradeLetter = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D';
type BoostLevel = 'strong' | 'moderate' | 'neutral' | 'negative';
type RecommendedSide = 'over' | 'under' | 'pass';
type SideStrength = 'strong' | 'moderate' | 'lean';
type PropEdgeType = 'points' | 'threes' | 'both' | 'none';

interface ZoneAnalysis {
  zone: ZoneType;
  playerFrequency: number;
  playerFgPct: number;
  defenseAllowedPct: number;
  advantage: number;
  defenseRank: number;
  defenseRating: DefenseRating;
}

interface PlayerMatchupAnalysis {
  playerName: string;
  teamAbbrev: string;
  opponentAbbrev: string;
  gameDescription: string;
  overallScore: number;
  zones: ZoneAnalysis[];
  primaryZone: ZoneType;
  recommendedSide: RecommendedSide;
  sideStrength: SideStrength;
  edgeScore: number;
  propEdgeType: PropEdgeType;
  scoringBoost: BoostLevel;
  threesBoost: BoostLevel;
}

// League average FG% by zone
const LEAGUE_AVG_BY_ZONE: Record<ZoneType, number> = {
  restricted_area: 0.65,
  paint: 0.42,
  mid_range: 0.41,
  corner_3: 0.38,
  above_break_3: 0.36,
};

// Get Eastern date string
const getEasternDate = (): string => {
  const now = new Date();
  const eastern = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return eastern.toISOString().split('T')[0];
};

// Parse team abbreviations from game description
const parseTeamsFromDescription = (description: string): { awayTeam: string; homeTeam: string } => {
  const parts = description.split(' @ ');
  if (parts.length !== 2) {
    return { awayTeam: '', homeTeam: '' };
  }
  return { awayTeam: parts[0].trim(), homeTeam: parts[1].trim() };
};

// Calculate matchup grade
const calculateGrade = (score: number): MatchupGradeLetter => {
  if (score > 8) return 'A+';
  if (score > 5) return 'A';
  if (score > 2) return 'B+';
  if (score > 0) return 'B';
  if (score > -3) return 'C';
  return 'D';
};

// Determine recommended side
const determineSide = (score: number): { side: RecommendedSide; strength: SideStrength } => {
  if (score >= 5) return { side: 'over', strength: 'strong' };
  if (score >= 2) return { side: 'over', strength: 'moderate' };
  if (score > 0) return { side: 'over', strength: 'lean' };
  if (score <= -5) return { side: 'under', strength: 'strong' };
  if (score <= -2) return { side: 'under', strength: 'moderate' };
  if (score < 0) return { side: 'under', strength: 'lean' };
  return { side: 'pass', strength: 'lean' };
};

// Calculate boost levels
const calculateBoostLevel = (grade: MatchupGradeLetter, primaryZone: ZoneType): BoostLevel => {
  const scoringZones: ZoneType[] = ['restricted_area', 'paint', 'mid_range'];
  const isScoring = scoringZones.includes(primaryZone);
  
  if ((grade === 'A+' || grade === 'A') && isScoring) return 'strong';
  if ((grade === 'B+' || grade === 'B') && isScoring) return 'moderate';
  if (grade === 'D') return 'negative';
  return 'neutral';
};

const calculateThreesBoostLevel = (zones: ZoneAnalysis[]): BoostLevel => {
  const threeZones = zones.filter(z => z.zone === 'corner_3' || z.zone === 'above_break_3');
  if (threeZones.length === 0) return 'neutral';
  const avgThreeAdvantage = threeZones.reduce((sum, z) => sum + z.advantage, 0) / threeZones.length;
  
  if (avgThreeAdvantage > 0.05) return 'strong';
  if (avgThreeAdvantage > 0.02) return 'moderate';
  if (avgThreeAdvantage < -0.05) return 'negative';
  return 'neutral';
};

// Determine prop edge type
const determinePropEdgeType = (scoringBoost: BoostLevel, threesBoost: BoostLevel): PropEdgeType => {
  const hasScoring = scoringBoost === 'strong' || scoringBoost === 'moderate';
  const hasThrees = threesBoost === 'strong' || threesBoost === 'moderate';
  
  if (hasScoring && hasThrees) return 'both';
  if (hasScoring) return 'points';
  if (hasThrees) return 'threes';
  return 'none';
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const todayET = getEasternDate();
    console.log(`[generate-matchup-scanner-picks] Starting for date: ${todayET}`);

    // Step 1: Fetch today's props (unique players with games)
    const [year, month, day] = todayET.split('-').map(Number);
    const startUTC = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const endUTC = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));

    const { data: todayProps, error: propsError } = await supabase
      .from('unified_props')
      .select('player_name, game_description, commence_time, event_id, prop_type, current_line')
      .gte('commence_time', startUTC.toISOString())
      .lt('commence_time', endUTC.toISOString())
      .eq('sport', 'basketball_nba')
      .eq('is_active', true)
      .or('outcome.is.null,outcome.eq.pending');

    if (propsError) throw new Error(`Failed to fetch props: ${propsError.message}`);

    // Get unique players with their game info and lines
    const playerMap = new Map<string, { 
      gameDescription: string; 
      commenceTime: string; 
      eventId: string;
      pointsLine: number | null;
      threesLine: number | null;
    }>();
    
    for (const prop of todayProps || []) {
      const existing = playerMap.get(prop.player_name);
      const propType = (prop.prop_type || '').toLowerCase();
      
      if (!existing) {
        playerMap.set(prop.player_name, {
          gameDescription: prop.game_description,
          commenceTime: prop.commence_time,
          eventId: prop.event_id,
          pointsLine: propType === 'points' || propType === 'player_points' ? prop.current_line : null,
          threesLine: propType === 'threes' || propType === 'player_threes' || propType === 'three_pointers' ? prop.current_line : null,
        });
      } else {
        // Update lines if found
        if ((propType === 'points' || propType === 'player_points') && !existing.pointsLine) {
          existing.pointsLine = prop.current_line;
        }
        if ((propType === 'threes' || propType === 'player_threes' || propType === 'three_pointers') && !existing.threesLine) {
          existing.threesLine = prop.current_line;
        }
      }
    }

    const playerNames = Array.from(playerMap.keys());
    console.log(`[generate-matchup-scanner-picks] Found ${playerNames.length} unique players`);

    if (playerNames.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No players with props today',
        saved: 0
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Step 2: Fetch player zone stats
    const { data: playerZones, error: zonesError } = await supabase
      .from('player_zone_stats')
      .select('*')
      .in('player_name', playerNames)
      .eq('season', '2024-25');

    if (zonesError) throw new Error(`Failed to fetch player zones: ${zonesError.message}`);

    // Step 3: Get all team abbreviations and fetch defense data
    const allTeams = new Set<string>();
    for (const [_, info] of playerMap) {
      const { awayTeam, homeTeam } = parseTeamsFromDescription(info.gameDescription);
      if (awayTeam) allTeams.add(awayTeam);
      if (homeTeam) allTeams.add(homeTeam);
    }

    const { data: defenseZones, error: defenseError } = await supabase
      .from('team_zone_defense')
      .select('*')
      .in('team_abbrev', Array.from(allTeams))
      .eq('season', '2024-25');

    if (defenseError) throw new Error(`Failed to fetch defense zones: ${defenseError.message}`);

    // Step 4: Calculate matchup analysis for each player
    const analyses: PlayerMatchupAnalysis[] = [];

    for (const [playerName, playerInfo] of playerMap) {
      const pZones = (playerZones || []).filter(z => z.player_name === playerName);
      if (pZones.length === 0) continue;

      const { awayTeam, homeTeam } = parseTeamsFromDescription(playerInfo.gameDescription);
      
      // Find opponent's defense - try both teams
      let dZones = (defenseZones || []).filter(z => z.team_abbrev === homeTeam);
      let opponentAbbrev = homeTeam;
      
      if (dZones.length === 0) {
        dZones = (defenseZones || []).filter(z => z.team_abbrev === awayTeam);
        opponentAbbrev = awayTeam;
      }
      
      if (dZones.length === 0) continue;

      // Calculate zone analysis
      const zones: ZoneAnalysis[] = [];
      let totalScore = 0;

      for (const pz of pZones) {
        const dz = dZones.find(d => d.zone === pz.zone);
        if (!dz) continue;

        const advantage = pz.fg_pct - dz.opp_fg_pct;
        const zoneScore = advantage * pz.frequency * 100;
        totalScore += zoneScore;

        zones.push({
          zone: pz.zone as ZoneType,
          playerFrequency: pz.frequency,
          playerFgPct: pz.fg_pct,
          defenseAllowedPct: dz.opp_fg_pct,
          advantage,
          defenseRank: dz.rank,
          defenseRating: dz.defense_rating as DefenseRating,
        });
      }

      zones.sort((a, b) => b.playerFrequency - a.playerFrequency);
      
      const primaryZone = zones[0]?.zone || 'mid_range';
      const overallGrade = calculateGrade(totalScore);
      const scoringBoost = calculateBoostLevel(overallGrade, primaryZone);
      const threesBoost = calculateThreesBoostLevel(zones);
      const { side, strength } = determineSide(totalScore);
      const propEdgeType = determinePropEdgeType(scoringBoost, threesBoost);

      analyses.push({
        playerName,
        teamAbbrev: awayTeam,
        opponentAbbrev,
        gameDescription: playerInfo.gameDescription,
        overallScore: Math.round(totalScore * 10) / 10,
        zones,
        primaryZone,
        recommendedSide: side,
        sideStrength: strength,
        edgeScore: Math.abs(totalScore),
        propEdgeType,
        scoringBoost,
        threesBoost,
      });
    }

    console.log(`[generate-matchup-scanner-picks] Analyzed ${analyses.length} players`);

    // Step 5: Filter to actionable picks and persist
    const picksToSave: any[] = [];

    for (const analysis of analyses) {
      // Skip pass and lean picks
      if (analysis.recommendedSide === 'pass') continue;
      if (analysis.sideStrength === 'lean') continue;

      const playerInfo = playerMap.get(analysis.playerName);
      if (!playerInfo) continue;

      // Save points picks
      if ((analysis.propEdgeType === 'points' || analysis.propEdgeType === 'both') && playerInfo.pointsLine) {
        picksToSave.push({
          category: 'MATCHUP_SCANNER_PTS',
          player_name: analysis.playerName,
          prop_type: 'points',
          recommended_side: analysis.recommendedSide,
          recommended_line: playerInfo.pointsLine,
          actual_line: playerInfo.pointsLine,
          confidence_score: analysis.edgeScore,
          analysis_date: todayET,
          outcome: 'pending',
          is_active: true,
          engine_version: 'matchup_scanner_v1',
          matchup_adjustment: analysis.overallScore,
        });
      }

      // Save threes picks
      if ((analysis.propEdgeType === 'threes' || analysis.propEdgeType === 'both') && playerInfo.threesLine) {
        picksToSave.push({
          category: 'MATCHUP_SCANNER_3PT',
          player_name: analysis.playerName,
          prop_type: 'threes',
          recommended_side: analysis.recommendedSide,
          recommended_line: playerInfo.threesLine,
          actual_line: playerInfo.threesLine,
          confidence_score: analysis.edgeScore,
          analysis_date: todayET,
          outcome: 'pending',
          is_active: true,
          engine_version: 'matchup_scanner_v1',
          matchup_adjustment: analysis.overallScore,
        });
      }
    }

    console.log(`[generate-matchup-scanner-picks] Saving ${picksToSave.length} picks`);

    // Upsert picks (avoid duplicates)
    if (picksToSave.length > 0) {
      for (const pick of picksToSave) {
        // Check if pick already exists
        const { data: existing } = await supabase
          .from('category_sweet_spots')
          .select('id')
          .eq('player_name', pick.player_name)
          .eq('prop_type', pick.prop_type)
          .eq('category', pick.category)
          .eq('analysis_date', pick.analysis_date)
          .maybeSingle();

        if (!existing) {
          const { error: insertError } = await supabase
            .from('category_sweet_spots')
            .insert(pick);

          if (insertError) {
            console.error(`Failed to insert pick for ${pick.player_name}: ${insertError.message}`);
          }
        }
      }
    }

    // Log to cron_job_history
    const duration = Date.now() - startTime;
    await supabase.from('cron_job_history').insert({
      job_name: 'generate-matchup-scanner-picks',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: {
        date: todayET,
        playersAnalyzed: analyses.length,
        picksSaved: picksToSave.length,
        breakdown: {
          points: picksToSave.filter(p => p.category === 'MATCHUP_SCANNER_PTS').length,
          threes: picksToSave.filter(p => p.category === 'MATCHUP_SCANNER_3PT').length,
        }
      }
    });

    console.log(`[generate-matchup-scanner-picks] Completed in ${duration}ms`);

    return new Response(JSON.stringify({
      success: true,
      date: todayET,
      duration_ms: duration,
      playersAnalyzed: analyses.length,
      picksSaved: picksToSave.length,
      breakdown: {
        points: picksToSave.filter(p => p.category === 'MATCHUP_SCANNER_PTS').length,
        threes: picksToSave.filter(p => p.category === 'MATCHUP_SCANNER_3PT').length,
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[generate-matchup-scanner-picks] Error:', errorMessage);

    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      await supabase.from('cron_job_history').insert({
        job_name: 'generate-matchup-scanner-picks',
        status: 'failed',
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        error_message: errorMessage
      });
    } catch {}

    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

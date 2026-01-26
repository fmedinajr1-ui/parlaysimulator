import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// v5.0 Baseline thresholds (old behavior)
const V5_EDGE_THRESHOLDS: Record<string, number> = {
  points: 1.5,
  rebounds: 1.0,
  assists: 0.8,
  threes: 0.5,
  pra: 3.0,
  pr: 2.0,
  pa: 2.0,
  ra: 1.5,
};

// v6.0 Synergy thresholds (new strict behavior)
const V6_EDGE_THRESHOLDS: Record<string, number> = {
  points: 4.5,
  rebounds: 2.5,
  assists: 2.0,
  threes: 1.0,
  pra: 6.0,
  pr: 4.0,
  pa: 4.0,
  ra: 3.0,
};

// Proven formula slot categories
const PROVEN_FORMULA = [
  { slot: 1, category: 'STAR_FLOOR_OVER' },
  { slot: 2, category: 'BIG_ASSIST_OVER' },
  { slot: 3, category: 'THREE_POINT_SHOOTER' },
  { slot: 4, category: 'LOW_SCORER_UNDER' },
  { slot: 5, category: 'ROLE_PLAYER_REB' },
  { slot: 6, category: 'BIG_REBOUNDER' },
];

interface Pick {
  id: string;
  player_name: string;
  prop_type: string;
  category: string;
  recommended_side: string;
  recommended_line: number | null;
  actual_line: number | null;
  projected_value: number | null;
  l10_avg: number | null;
  l10_hit_rate: number | null;
  confidence_score: number | null;
  outcome: string | null;
  team_name: string | null;
  archetype: string | null;
  analysis_date: string;
}

interface GameContext {
  team_abbrev: string;
  vegas_total: number | null;
  pace_rating: string | null;
}

interface SelectedLeg extends Pick {
  edge: number;
  score: number;
}

interface GradeResult {
  hit: number;
  miss: number;
  push: number;
  allHit: boolean;
  hitRate: number;
}

// Normalize prop type for threshold lookup
function getPropType(propType: string): string {
  const normalized = propType.toLowerCase().replace(/[_\s-]+/g, '');
  if (normalized.includes('point') && normalized.includes('rebound') && normalized.includes('assist')) return 'pra';
  if (normalized.includes('point') && normalized.includes('rebound')) return 'pr';
  if (normalized.includes('point') && normalized.includes('assist')) return 'pa';
  if (normalized.includes('rebound') && normalized.includes('assist')) return 'ra';
  if (normalized.includes('point') || normalized === 'pts') return 'points';
  if (normalized.includes('rebound') || normalized === 'reb') return 'rebounds';
  if (normalized.includes('assist') || normalized === 'ast') return 'assists';
  if (normalized.includes('three') || normalized === '3pt') return 'threes';
  return 'points';
}

// Reconstruct projection from available data
function reconstructProjection(pick: Pick): number | null {
  if (pick.projected_value !== null && pick.projected_value !== undefined) return pick.projected_value;
  if (pick.l10_avg !== null && pick.l10_avg !== undefined) return pick.l10_avg;
  if (pick.recommended_line !== null && pick.recommended_line !== undefined) return pick.recommended_line;
  if (pick.actual_line !== null && pick.actual_line !== undefined) return pick.actual_line;
  return null;
}

// Calculate edge value
function calculateEdge(pick: Pick, projection: number): number {
  const line = pick.actual_line ?? pick.recommended_line ?? 0;
  const isOver = pick.recommended_side?.toLowerCase() === 'over';
  return isOver ? projection - line : line - projection;
}

// Score a pick (base scoring logic)
function scorePick(pick: Pick, edge: number): number {
  const l10 = pick.l10_hit_rate ?? 0.6;
  const conf = pick.confidence_score ?? 0.7;
  return (l10 * 6) + (conf * 0.25) + (edge * 0.15);
}

// Calculate synergy between two legs
function calculateLegSynergy(leg1: Pick, leg2: Pick, gameContexts: Map<string, GameContext>): number {
  let synergy = 0;
  
  const team1 = leg1.team_name?.toLowerCase() || '';
  const team2 = leg2.team_name?.toLowerCase() || '';
  const sameTeam = team1 === team2 && team1 !== '';
  
  const ctx1 = gameContexts.get(team1);
  const ctx2 = gameContexts.get(team2);
  const vegasTotal1 = ctx1?.vegas_total || 220;
  const vegasTotal2 = ctx2?.vegas_total || 220;
  
  // Hard conflict: same player opposite sides
  if (leg1.player_name === leg2.player_name && 
      leg1.recommended_side?.toLowerCase() !== leg2.recommended_side?.toLowerCase()) {
    return -2;
  }
  
  // Soft conflict: same team both OVER points (usage competition)
  const prop1 = getPropType(leg1.prop_type);
  const prop2 = getPropType(leg2.prop_type);
  
  if (sameTeam && prop1 === 'points' && prop2 === 'points' &&
      leg1.recommended_side?.toLowerCase() === 'over' && 
      leg2.recommended_side?.toLowerCase() === 'over') {
    return -1;
  }
  
  // Synergy: SLOW game (< 215) favors rebounds OVER
  if (vegasTotal1 < 215 || vegasTotal2 < 215) {
    if (prop1 === 'rebounds' && prop2 === 'rebounds' &&
        leg1.recommended_side?.toLowerCase() === 'over' && 
        leg2.recommended_side?.toLowerCase() === 'over') {
      synergy += 1;
    }
    // SLOW game favors UNDER points
    if ((prop1 === 'points' || prop2 === 'points') &&
        (leg1.recommended_side?.toLowerCase() === 'under' || 
         leg2.recommended_side?.toLowerCase() === 'under')) {
      synergy += 0.5;
    }
  }
  
  // Synergy: FAST game (> 228) favors points/assists OVER
  if ((vegasTotal1 > 228 || vegasTotal2 > 228) && !sameTeam) {
    if ((prop1 === 'points' || prop1 === 'assists') &&
        (prop2 === 'points' || prop2 === 'assists') &&
        leg1.recommended_side?.toLowerCase() === 'over' && 
        leg2.recommended_side?.toLowerCase() === 'over') {
      synergy += 1;
    }
  }
  
  // Synergy: Different prop types from same team (complementary)
  if (sameTeam && prop1 !== prop2) {
    synergy += 0.3;
  }
  
  return synergy;
}

// Build v5.0 baseline parlay (no edge blocking, no synergy)
function buildV5Parlay(picks: Pick[]): { selected: SelectedLeg[], blocked: Pick[] } {
  const selected: SelectedLeg[] = [];
  const blocked: Pick[] = [];
  
  for (const slot of PROVEN_FORMULA) {
    const candidates = picks.filter(p => p.category === slot.category);
    
    if (candidates.length === 0) continue;
    
    // Simple scoring: L10 * 6 + confidence * 0.25 (no edge requirement)
    let best: SelectedLeg | null = null;
    let bestScore = -Infinity;
    
    for (const pick of candidates) {
      const projection = reconstructProjection(pick);
      const edge = projection !== null ? calculateEdge(pick, projection) : 0;
      const score = scorePick(pick, edge);
      
      if (score > bestScore) {
        bestScore = score;
        best = { ...pick, edge, score };
      }
    }
    
    if (best) {
      selected.push(best);
    }
  }
  
  return { selected, blocked };
}

// Build v6.0 synergy parlay (strict edge, synergy scoring, conflict detection)
function buildV6Parlay(
  picks: Pick[], 
  gameContexts: Map<string, GameContext>
): { selected: SelectedLeg[], blocked: Pick[], blockedByEdge: Pick[], blockedBySynergy: Pick[] } {
  const selected: SelectedLeg[] = [];
  const blocked: Pick[] = [];
  const blockedByEdge: Pick[] = [];
  const blockedBySynergy: Pick[] = [];
  
  for (const slot of PROVEN_FORMULA) {
    const candidates = picks.filter(p => p.category === slot.category);
    
    if (candidates.length === 0) continue;
    
    let best: SelectedLeg | null = null;
    let bestCombinedScore = -Infinity;
    
    for (const pick of candidates) {
      const projection = reconstructProjection(pick);
      
      // Hard block: null projection
      if (projection === null) {
        blockedByEdge.push(pick);
        continue;
      }
      
      const edge = calculateEdge(pick, projection);
      const propType = getPropType(pick.prop_type);
      const threshold = V6_EDGE_THRESHOLDS[propType] || 2.0;
      
      // Hard block: insufficient edge
      if (edge < threshold) {
        blockedByEdge.push(pick);
        continue;
      }
      
      // Calculate synergy with already selected legs
      let totalSynergy = 0;
      for (const selectedLeg of selected) {
        totalSynergy += calculateLegSynergy(pick, selectedLeg, gameContexts);
      }
      
      // Hard block: severe conflict
      if (totalSynergy <= -2) {
        blockedBySynergy.push(pick);
        continue;
      }
      
      const baseScore = scorePick(pick, edge);
      const combinedScore = baseScore + (totalSynergy * 2.0);
      
      if (combinedScore > bestCombinedScore) {
        bestCombinedScore = combinedScore;
        best = { ...pick, edge, score: combinedScore };
      }
    }
    
    if (best) {
      selected.push(best);
    }
  }
  
  return { selected, blocked, blockedByEdge, blockedBySynergy };
}

// Grade parlay outcomes
function gradeParlayOutcomes(legs: SelectedLeg[]): GradeResult {
  let hit = 0, miss = 0, push = 0;
  
  for (const leg of legs) {
    if (leg.outcome === 'hit') hit++;
    else if (leg.outcome === 'miss') miss++;
    else if (leg.outcome === 'push') push++;
  }
  
  const decided = hit + miss;
  return {
    hit,
    miss,
    push,
    allHit: miss === 0 && hit > 0,
    hitRate: decided > 0 ? hit / decided : 0
  };
}

// Get unique dates from picks
function getUniqueDates(picks: Pick[]): string[] {
  const dates = new Set(picks.map(p => p.analysis_date));
  return Array.from(dates).sort();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request
    const body = await req.json();
    const dateStart = body.dateStart || '2026-01-23';
    const dateEnd = body.dateEnd || '2026-01-24';
    const versions = body.versions || ['v5.0_baseline', 'v6.0_synergy'];
    const parlayType = body.parlayType || 'OPTIMAL_6';

    console.log(`[run-parlay-backtest] Starting backtest from ${dateStart} to ${dateEnd}`);

    // Fetch all settled picks in date range
    const { data: allPicks, error: picksError } = await supabase
      .from('category_sweet_spots')
      .select('*')
      .gte('analysis_date', dateStart)
      .lte('analysis_date', dateEnd)
      .in('outcome', ['hit', 'miss', 'push'])
      .eq('is_active', true);

    if (picksError) {
      throw new Error(`Failed to fetch picks: ${picksError.message}`);
    }

    console.log(`[run-parlay-backtest] Found ${allPicks?.length || 0} settled picks`);

    if (!allPicks || allPicks.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No settled picks found in date range'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Fetch game environments for synergy calculation
    const { data: gameEnvData } = await supabase
      .from('game_environment')
      .select('team_abbrev, vegas_total, pace_rating')
      .gte('game_date', dateStart)
      .lte('game_date', dateEnd);

    const gameContexts = new Map<string, GameContext>();
    for (const env of gameEnvData || []) {
      if (env.team_abbrev) {
        gameContexts.set(env.team_abbrev.toLowerCase(), env);
      }
    }

    const dates = getUniqueDates(allPicks as Pick[]);
    const runResults: any[] = [];

    // Run backtest for each version
    for (const version of versions) {
      console.log(`[run-parlay-backtest] Running ${version} simulation...`);

      let totalLegs = 0, totalHits = 0, totalMisses = 0, totalPushes = 0;
      let totalParlays = 0, fullWins = 0;
      let totalSynergySum = 0, totalEdgeSum = 0;
      let picksBlockedByEdge = 0, picksBlockedBySynergy = 0;
      const slateResults: any[] = [];

      // Process each date
      for (const date of dates) {
        const datePicks = (allPicks as Pick[]).filter(p => p.analysis_date === date);
        
        let result;
        if (version === 'v5.0_baseline') {
          const { selected, blocked } = buildV5Parlay(datePicks);
          result = {
            selected,
            blockedByEdge: [] as Pick[],
            blockedBySynergy: [] as Pick[],
            totalSynergy: 0
          };
        } else {
          const { selected, blockedByEdge, blockedBySynergy } = buildV6Parlay(datePicks, gameContexts);
          
          // Calculate total synergy for selected legs
          let totalSynergy = 0;
          for (let i = 0; i < selected.length; i++) {
            for (let j = i + 1; j < selected.length; j++) {
              totalSynergy += calculateLegSynergy(selected[i], selected[j], gameContexts);
            }
          }
          
          result = { selected, blockedByEdge, blockedBySynergy, totalSynergy };
          picksBlockedByEdge += blockedByEdge.length;
          picksBlockedBySynergy += blockedBySynergy.length;
        }

        if (result.selected.length === 0) continue;

        const graded = gradeParlayOutcomes(result.selected);
        
        totalLegs += result.selected.length;
        totalHits += graded.hit;
        totalMisses += graded.miss;
        totalPushes += graded.push;
        totalParlays++;
        if (graded.allHit) fullWins++;
        
        const avgEdge = result.selected.reduce((sum, leg) => sum + leg.edge, 0) / result.selected.length;
        totalEdgeSum += avgEdge;
        totalSynergySum += result.totalSynergy;

        // Build leg details for storage
        const legDetails = result.selected.map(leg => ({
          player_name: leg.player_name,
          prop_type: leg.prop_type,
          category: leg.category,
          side: leg.recommended_side,
          line: leg.actual_line ?? leg.recommended_line,
          edge: leg.edge,
          outcome: leg.outcome,
          l10_hit_rate: leg.l10_hit_rate,
          confidence_score: leg.confidence_score
        }));

        slateResults.push({
          slate_date: date,
          parlay_type: parlayType,
          legs: legDetails,
          leg_count: result.selected.length,
          legs_hit: graded.hit,
          legs_missed: graded.miss,
          legs_pushed: graded.push,
          all_legs_hit: graded.allHit,
          total_synergy_score: result.totalSynergy,
          conflicts_detected: result.blockedBySynergy.length,
          edge_blocked_count: result.blockedByEdge.length,
          avg_edge_value: avgEdge
        });
      }

      const legHitRate = (totalHits + totalMisses) > 0 ? totalHits / (totalHits + totalMisses) : 0;
      const parlayWinRate = totalParlays > 0 ? fullWins / totalParlays : 0;
      const avgSynergy = totalParlays > 0 ? totalSynergySum / totalParlays : 0;
      const avgEdge = totalParlays > 0 ? totalEdgeSum / totalParlays : 0;

      // Insert run record
      const { data: runData, error: runError } = await supabase
        .from('backtest_runs')
        .insert({
          run_name: `${version} Backtest ${dateStart} to ${dateEnd}`,
          date_range_start: dateStart,
          date_range_end: dateEnd,
          builder_version: version,
          config: version === 'v6.0_synergy' ? { thresholds: V6_EDGE_THRESHOLDS, synergy: true } : { thresholds: V5_EDGE_THRESHOLDS, synergy: false },
          total_slates: dates.length,
          total_parlays_built: totalParlays,
          total_legs: totalLegs,
          legs_hit: totalHits,
          legs_missed: totalMisses,
          legs_pushed: totalPushes,
          leg_hit_rate: legHitRate,
          parlay_win_rate: parlayWinRate,
          avg_synergy_score: avgSynergy,
          avg_edge_value: avgEdge,
          picks_blocked_by_edge: picksBlockedByEdge,
          picks_blocked_by_synergy: picksBlockedBySynergy,
          completed_at: new Date().toISOString()
        })
        .select('id')
        .single();

      if (runError) {
        console.error(`Failed to insert run: ${runError.message}`);
        continue;
      }

      const runId = runData.id;

      // Insert slate results
      if (slateResults.length > 0) {
        const slateRecords = slateResults.map(sr => ({ ...sr, run_id: runId }));
        await supabase.from('backtest_parlay_results').insert(slateRecords);
      }

      runResults.push({
        version,
        runId,
        summary: {
          totalSlates: dates.length,
          totalParlays,
          totalLegs,
          legsHit: totalHits,
          legsMissed: totalMisses,
          legsPushed: totalPushes,
          legHitRate: Math.round(legHitRate * 10000) / 100,
          parlayWinRate: Math.round(parlayWinRate * 10000) / 100,
          avgSynergyScore: Math.round(avgSynergy * 100) / 100,
          avgEdgeValue: Math.round(avgEdge * 100) / 100,
          picksBlockedByEdge,
          picksBlockedBySynergy
        }
      });
    }

    // Calculate comparison if both versions ran
    let comparison = null;
    const v5Run = runResults.find(r => r.version === 'v5.0_baseline');
    const v6Run = runResults.find(r => r.version === 'v6.0_synergy');

    if (v5Run && v6Run) {
      // Analyze blocked picks outcomes
      const blockedPicks = (allPicks as Pick[]).filter(p => {
        const projection = reconstructProjection(p);
        if (!projection) return true;
        const edge = calculateEdge(p, projection);
        const threshold = V6_EDGE_THRESHOLDS[getPropType(p.prop_type)] || 2.0;
        return edge < threshold;
      });

      const blockedThatMissed = blockedPicks.filter(p => p.outcome === 'miss').length;
      const blockedThatHit = blockedPicks.filter(p => p.outcome === 'hit').length;
      const blockingEffectiveness = (blockedThatMissed + blockedThatHit) > 0 
        ? blockedThatMissed / (blockedThatMissed + blockedThatHit) 
        : 0;

      comparison = {
        v5LegHitRate: v5Run.summary.legHitRate,
        v6LegHitRate: v6Run.summary.legHitRate,
        legHitImprovement: Math.round((v6Run.summary.legHitRate - v5Run.summary.legHitRate) * 100) / 100,
        v5ParlayWinRate: v5Run.summary.parlayWinRate,
        v6ParlayWinRate: v6Run.summary.parlayWinRate,
        parlayWinImprovement: Math.round((v6Run.summary.parlayWinRate - v5Run.summary.parlayWinRate) * 100) / 100,
        blockedPicksAnalysis: {
          total: blockedPicks.length,
          wouldHaveMissed: blockedThatMissed,
          wouldHaveHit: blockedThatHit,
          blockingEffectiveness: Math.round(blockingEffectiveness * 10000) / 100
        }
      };

      // Update v6 run with improvement metric
      if (v6Run.runId) {
        await supabase
          .from('backtest_runs')
          .update({
            baseline_run_id: v5Run.runId,
            improvement_vs_baseline: comparison.legHitImprovement
          })
          .eq('id', v6Run.runId);
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[run-parlay-backtest] Completed in ${duration}ms`);

    return new Response(JSON.stringify({
      success: true,
      dateRange: { start: dateStart, end: dateEnd },
      totalSettledPicks: allPicks.length,
      uniqueDates: dates.length,
      durationMs: duration,
      runs: runResults,
      comparison
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[run-parlay-backtest] Error:', errorMessage);

    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

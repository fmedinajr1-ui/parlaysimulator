import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MedianPick {
  id: string;
  player_name: string;
  stat_type: string;
  sportsbook_line: number;
  recommendation: string;
  confidence_tier: string;
  edge: number;
  median10: number;
  median5: number;
  adjusted_median: number;
  volatility: number;
  defense_code: number;
  event_id: string;
  game_description: string;
  commence_time: string;
  expected_minutes: number;
  engine_version: string;
}

interface HitRatePick {
  id: string;
  player_name: string;
  stat_type: string;
  line: number;
  hit_rate_over: number;
  hit_rate_under: number;
  games_analyzed: number;
  event_id: string;
  commence_time: string;
}

interface UnifiedLeg {
  player_name: string;
  prop_type: string;
  stat_type: string;
  line: number;
  odds: number;
  direction: string;
  hit_rate: number;
  median10: number;
  median5: number;
  adjusted_median: number;
  edge: number;
  confidence_tier: string;
  defense_code: number;
  event_id: string;
  game_description: string;
  commence_time: string;
}

interface Parlay {
  id: string;
  legs: UnifiedLeg[];
  total_odds: number;
  win_probability_est: number;
  risk_label: string;
  tags: string[];
}

// Prop type mapping between different schemas
const PROP_TYPE_MAP: Record<string, string[]> = {
  'points': ['player_points', 'points'],
  'rebounds': ['player_rebounds', 'rebounds'],
  'assists': ['player_assists', 'assists'],
  'threes': ['player_threes', 'threes', 'three_pointers'],
  'steals': ['player_steals', 'steals'],
  'blocks': ['player_blocks', 'blocks'],
  'turnovers': ['player_turnovers', 'turnovers'],
  'points_rebounds_assists': ['player_pra', 'pra', 'points_rebounds_assists'],
  'points_rebounds': ['player_pr', 'pr', 'points_rebounds'],
  'points_assists': ['player_pa', 'pa', 'points_assists'],
  'rebounds_assists': ['player_ra', 'ra', 'rebounds_assists'],
};

// Base stats that combo stats contain
const COMBO_STAT_BASES: Record<string, string[]> = {
  'points_rebounds_assists': ['points', 'rebounds', 'assists'],
  'points_rebounds': ['points', 'rebounds'],
  'points_assists': ['points', 'assists'],
  'rebounds_assists': ['rebounds', 'assists'],
};

function normalizeStatType(stat: string): string {
  const lower = stat.toLowerCase().replace(/_/g, ' ').replace(/player /g, '');
  for (const [normalized, variants] of Object.entries(PROP_TYPE_MAP)) {
    if (variants.some(v => lower.includes(v.replace(/_/g, ' ')))) {
      return normalized;
    }
  }
  return lower.replace(/ /g, '_');
}

function noSamePlayer(legs: UnifiedLeg[]): boolean {
  const players = legs.map(l => l.player_name.toLowerCase().trim());
  return players.length === new Set(players).size;
}

function noBaseComboOverlap(legs: UnifiedLeg[]): boolean {
  const playerStats = new Map<string, Set<string>>();
  
  for (const leg of legs) {
    const player = leg.player_name.toLowerCase().trim();
    const stat = normalizeStatType(leg.stat_type);
    
    if (!playerStats.has(player)) {
      playerStats.set(player, new Set());
    }
    
    const existing = playerStats.get(player)!;
    
    // Check if current stat is a combo that overlaps with existing base stats
    const comboBases = COMBO_STAT_BASES[stat];
    if (comboBases) {
      for (const base of comboBases) {
        if (existing.has(base)) return false;
      }
    }
    
    // Check if current stat is a base that overlaps with existing combos
    for (const [combo, bases] of Object.entries(COMBO_STAT_BASES)) {
      if (existing.has(combo) && bases.includes(stat)) {
        return false;
      }
    }
    
    existing.add(stat);
  }
  
  return true;
}

function noSameEventInSafeMode(legs: UnifiedLeg[], mode: string): boolean {
  if (mode !== 'safe') return true;
  const events = legs.map(l => l.event_id).filter(Boolean);
  return events.length === new Set(events).size;
}

function calculateTotalOdds(legs: UnifiedLeg[]): number {
  // Each leg at -110 = 1.91 decimal
  // For simplicity, calculate based on leg count
  const decimalOdds = legs.reduce((acc) => acc * 1.91, 1);
  // Convert to American odds
  if (decimalOdds >= 2) {
    return Math.round((decimalOdds - 1) * 100);
  }
  return Math.round(-100 / (decimalOdds - 1));
}

function calculateWinProbability(legs: UnifiedLeg[]): number {
  return legs.reduce((acc, leg) => acc * leg.hit_rate, 1);
}

function getRiskLabel(legs: UnifiedLeg[]): string {
  const avgHitRate = legs.reduce((sum, l) => sum + l.hit_rate, 0) / legs.length;
  const minTier = Math.min(...legs.map(l => {
    if (l.confidence_tier === 'A') return 1;
    if (l.confidence_tier === 'B') return 2;
    return 3;
  }));
  
  if (avgHitRate >= 0.70 && minTier <= 2) return 'LOW';
  if (avgHitRate >= 0.65 && minTier <= 3) return 'MED';
  return 'HIGH';
}

function getTags(legs: UnifiedLeg[]): string[] {
  const tags = ['HITRATE+MEDIAN', 'UNCORRELATED'];
  
  const minTier = Math.min(...legs.map(l => {
    if (l.confidence_tier === 'A') return 1;
    if (l.confidence_tier === 'B') return 2;
    return 3;
  }));
  
  if (minTier <= 2) tags.push('TIER_B+');
  if (minTier === 1) tags.push('TIER_A');
  
  return tags;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { mode = 'safe' } = await req.json().catch(() => ({}));
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();

    console.log(`[homepage-suggestions-engine] Starting with mode: ${mode}, date: ${today}`);

    // Fetch Median v2 picks for today
    const { data: medianPicks, error: medianError } = await supabase
      .from('median_edge_picks')
      .select('*')
      .eq('game_date', today)
      .eq('engine_version', 'v2')
      .in('recommendation', ['LEAN OVER', 'LEAN UNDER', 'STRONG OVER', 'STRONG UNDER']);

    if (medianError) {
      console.error('[homepage-suggestions-engine] Median fetch error:', medianError);
      throw medianError;
    }

    console.log(`[homepage-suggestions-engine] Found ${medianPicks?.length || 0} Median v2 picks`);

    // Fetch HitRate picks - use expire check since commence_time may be past for some
    const { data: hitratePicks, error: hitrateError } = await supabase
      .from('player_prop_hitrates')
      .select('*')
      .gte('expires_at', now)
      .gte('games_analyzed', 8);

    if (hitrateError) {
      console.error('[homepage-suggestions-engine] HitRate fetch error:', hitrateError);
      throw hitrateError;
    }

    console.log(`[homepage-suggestions-engine] Found ${hitratePicks?.length || 0} HitRate picks`);

    // Join picks by player + stat + line tolerance
    const unifiedLegs: UnifiedLeg[] = [];
    const hasHitrateData = (hitratePicks?.length || 0) > 0;

    console.log(`[homepage-suggestions-engine] HitRate data available: ${hasHitrateData}`);

    for (const median of (medianPicks || [])) {
      const normalizedMedianStat = normalizeStatType(median.stat_type);
      const medianDirection = median.recommendation.includes('OVER') ? 'OVER' : 'UNDER';
      
      // Quality gates for median
      if ((median.volatility || 0) > 0.35) continue;
      if ((median.expected_minutes || 30) < 24) continue;
      if (!['A', 'B', 'C'].includes(median.confidence_tier || 'D')) continue;

      // Get hit rate - from external HitRate table or Median's built-in hit rates
      let finalHitRate: number;
      let hasUnifiedAgreement = false;

      if (hasHitrateData) {
        // Find matching HitRate pick (hitrate uses prop_type and current_line)
        const matchingHitrate = (hitratePicks || []).find(hr => {
          const normalizedHrStat = normalizeStatType(hr.prop_type || '');
          const playerMatch = hr.player_name?.toLowerCase().trim() === median.player_name?.toLowerCase().trim();
          const statMatch = normalizedHrStat === normalizedMedianStat;
          const lineTolerance = Math.abs((hr.current_line || 0) - (median.sportsbook_line || 0)) <= 0.5;
          
          return playerMatch && statMatch && lineTolerance;
        });

        if (matchingHitrate) {
          // Check HitRate direction agreement
          const hrHitRateOver = matchingHitrate.hit_rate_over || 0;
          const hrHitRateUnder = matchingHitrate.hit_rate_under || 0;
          
          const isStrong = median.recommendation.includes('STRONG');
          const hitRateThreshold = isStrong ? 0.70 : 0.65;
          
          let hrDirection: string | null = null;
          if (hrHitRateOver >= hitRateThreshold && hrHitRateOver > hrHitRateUnder) {
            hrDirection = 'OVER';
          } else if (hrHitRateUnder >= hitRateThreshold && hrHitRateUnder > hrHitRateOver) {
            hrDirection = 'UNDER';
          }

          if (hrDirection && hrDirection === medianDirection) {
            finalHitRate = medianDirection === 'OVER' ? hrHitRateOver : hrHitRateUnder;
            hasUnifiedAgreement = true;
          } else {
            continue; // No agreement, skip
          }
        } else {
          continue; // No matching hitrate data, skip
        }
      } else {
        // FALLBACK: Use Median v2's built-in hit rates when no external HitRate data
        const medianHitRateOver = median.hit_rate_over_10 || 0;
        const medianHitRateUnder = median.hit_rate_under_10 || 0;
        
        finalHitRate = medianDirection === 'OVER' ? medianHitRateOver : medianHitRateUnder;
        
        // Require at least 60% hit rate for fallback mode
        if (finalHitRate < 0.60) continue;
        
        // Only Tier A/B in fallback mode for higher quality
        if (!['A', 'B'].includes(median.confidence_tier || 'D')) continue;
        
        hasUnifiedAgreement = true; // Median's internal agreement
      }

      if (!hasUnifiedAgreement) continue;

      unifiedLegs.push({
        player_name: median.player_name,
        prop_type: `player_${normalizedMedianStat}`,
        stat_type: normalizedMedianStat,
        line: median.sportsbook_line,
        odds: -110, // Default odds
        direction: medianDirection,
        hit_rate: finalHitRate,
        median10: median.true_median || 0,
        median5: median.median5 || 0,
        adjusted_median: median.adjusted_median || 0,
        edge: median.edge || 0,
        confidence_tier: median.confidence_tier || 'C',
        defense_code: median.defense_code || 50,
        event_id: median.event_id || '',
        game_description: `${median.team_name || ''} vs ${median.opponent_team || ''}`,
        commence_time: median.game_time || '',
      });
    }

    console.log(`[homepage-suggestions-engine] Found ${unifiedLegs.length} unified legs`);

    if (unifiedLegs.length < 2) {
      return new Response(JSON.stringify({
        success: true,
        mode,
        parlays: [],
        no_bet_reason: 'Insufficient quality picks today - board is weak',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Sort legs by quality score (hit_rate * edge weight + tier bonus)
    const scoredLegs = unifiedLegs.map(leg => ({
      ...leg,
      score: (leg.hit_rate * 100) + (Math.abs(leg.edge) * 5) + 
             (leg.confidence_tier === 'A' ? 20 : leg.confidence_tier === 'B' ? 10 : 0),
    })).sort((a, b) => b.score - a.score);

    // Build parlays with correlation veto
    const parlays: Parlay[] = [];
    const usedLegIds = new Set<string>();
    const maxParlays = mode === 'safe' ? 6 : 10;
    const maxLegs = mode === 'safe' ? 2 : 3;

    // Safe mode: prefer 2-leg, allow 3 if all Tier A/B
    const targetLegCounts = mode === 'safe' ? [2, 3] : [3, 2];

    for (const targetLegs of targetLegCounts) {
      if (parlays.length >= maxParlays) break;

      // Try to build parlays with this leg count
      for (let i = 0; i < scoredLegs.length && parlays.length < maxParlays; i++) {
        const primaryLeg = scoredLegs[i];
        const legKey = `${primaryLeg.player_name}-${primaryLeg.stat_type}`.toLowerCase();
        
        if (usedLegIds.has(legKey)) continue;

        const candidateLegs: UnifiedLeg[] = [primaryLeg];

        // Find compatible additional legs
        for (const leg of scoredLegs) {
          if (candidateLegs.length >= targetLegs) break;
          
          const candidateLegKey = `${leg.player_name}-${leg.stat_type}`.toLowerCase();
          if (usedLegIds.has(candidateLegKey)) continue;
          if (candidateLegs.some(cl => `${cl.player_name}-${cl.stat_type}`.toLowerCase() === candidateLegKey)) continue;

          const testLegs = [...candidateLegs, leg];

          // Apply all correlation veto rules
          if (!noSamePlayer(testLegs)) continue;
          if (!noBaseComboOverlap(testLegs)) continue;
          if (!noSameEventInSafeMode(testLegs, mode)) continue;

          // For Safe mode with 3 legs, require all Tier A/B
          if (mode === 'safe' && targetLegs === 3) {
            const allHighTier = testLegs.every(l => ['A', 'B'].includes(l.confidence_tier));
            if (!allHighTier) continue;
          }

          candidateLegs.push(leg);
        }

        // Only create parlay if we have enough legs
        if (candidateLegs.length >= 2 && candidateLegs.length >= targetLegs) {
          // Mark legs as used
          candidateLegs.forEach(leg => {
            usedLegIds.add(`${leg.player_name}-${leg.stat_type}`.toLowerCase());
          });

          parlays.push({
            id: crypto.randomUUID(),
            legs: candidateLegs,
            total_odds: calculateTotalOdds(candidateLegs),
            win_probability_est: calculateWinProbability(candidateLegs),
            risk_label: getRiskLabel(candidateLegs),
            tags: getTags(candidateLegs),
          });
        }
      }
    }

    // Sort parlays by win probability for deterministic display
    parlays.sort((a, b) => b.win_probability_est - a.win_probability_est);

    console.log(`[homepage-suggestions-engine] Built ${parlays.length} parlays`);

    return new Response(JSON.stringify({
      success: true,
      mode,
      parlays,
      no_bet_reason: parlays.length === 0 ? 'No qualifying parlays today - board is weak' : null,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[homepage-suggestions-engine] Error:', errorMessage);
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
      parlays: [],
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

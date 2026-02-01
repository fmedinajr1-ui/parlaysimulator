import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useParlayBuilder } from "@/contexts/ParlayBuilderContext";
import { toast } from "sonner";

// Get today's date in Eastern Time for consistent filtering
function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export interface EliteThreesPick {
  id: string;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  l10HitRate: number;
  l10Min?: number;
  l10Avg?: number;
  confidenceScore: number;
  team: string;
  projectedValue?: number | null;
  edge?: number;
  reliabilityTier?: string | null;
  reliabilityHitRate?: number | null;
  varianceTier?: 'LOW' | 'MEDIUM' | 'HIGH';
  qualityTier?: 'ELITE' | 'PREMIUM' | 'STANDARD' | 'HOT' | 'BLOCKED';
  shootingEfficiencyTier?: 'HOT_SHOOTING' | 'NORMAL' | 'COLD_SHOOTING' | null;
  l5ThreePct?: number | null;
  h2hMatchup?: {
    opponent: string;
    avgVsTeam: number;
    tier: string;
    hitRateVsTeam?: number;
    worstVsTeam?: number;
    bestVsTeam?: number;
  } | null;
  h2hBoost?: number;
}

interface EliteThreesResult {
  picks: EliteThreesPick[];
  isLoading: boolean;
  combinedProbability: number;
  theoreticalOdds: string;
}

// ============ 3PT SHOOTER FILTERS (v7.0 - Enhanced Mother Logic) ============
const THREES_FILTER_CONFIG = {
  MIN_EDGE_BY_VARIANCE: { LOW: 0.3, MEDIUM: 0.8, HIGH: 1.2 } as Record<string, number>,
  MAX_VARIANCE_BY_EDGE: { FAVORABLE: 3.0, NEUTRAL: 1.5, TIGHT: 1.0 } as Record<string, number>,
  MIN_FLOOR_FOR_TIGHT_LINES: 2,
  HOT_STREAK_MULTIPLIER: 1.15,
  COLD_STREAK_MULTIPLIER: 0.85,
  // NEW: H2H Boost Factors
  H2H_BOOST: {
    ELITE_WITH_FLOOR: 0.15,   // ELITE_MATCHUP + floor >= line
    ELITE_MATCHUP: 0.10,      // ELITE_MATCHUP tier
    GOOD_MATCHUP: 0.05,       // GOOD_MATCHUP tier
    VOLATILE_PENALTY: -0.05,  // VOLATILE_MATCHUP penalty
  },
  // NEW: Shooting Efficiency Thresholds
  SHOOTING_EFFICIENCY: {
    HOT_THRESHOLD: 0.40,      // L5 3PT% >= 40%
    COLD_THRESHOLD: 0.30,     // L5 3PT% < 30%
    MIN_ATTEMPTS_PER_GAME: 3, // Minimum attempts to qualify
  },
};

// Calculate H2H boost factor based on matchup tier and floor
function calculateH2HBoost(
  matchupTier: string | null,
  worstVsTeam: number | null,
  line: number
): number {
  if (!matchupTier) return 0;
  
  const config = THREES_FILTER_CONFIG.H2H_BOOST;
  
  if (matchupTier === 'ELITE_MATCHUP') {
    // Extra boost if floor vs this team is >= line
    if (worstVsTeam !== null && worstVsTeam >= line) {
      return config.ELITE_WITH_FLOOR;
    }
    return config.ELITE_MATCHUP;
  }
  
  if (matchupTier === 'GOOD_MATCHUP') {
    return config.GOOD_MATCHUP;
  }
  
  if (matchupTier === 'VOLATILE_MATCHUP' || matchupTier === 'VOLATILE') {
    return config.VOLATILE_PENALTY;
  }
  
  return 0;
}

// Determine shooting efficiency tier based on L5 3PT%
function getShootingEfficiencyTier(
  l5ThreePct: number | null
): 'HOT_SHOOTING' | 'NORMAL' | 'COLD_SHOOTING' | null {
  if (l5ThreePct === null) return null;
  
  const config = THREES_FILTER_CONFIG.SHOOTING_EFFICIENCY;
  
  if (l5ThreePct >= config.HOT_THRESHOLD) return 'HOT_SHOOTING';
  if (l5ThreePct < config.COLD_THRESHOLD) return 'COLD_SHOOTING';
  return 'NORMAL';
}

// Validate 3PT candidate against variance-edge matrix
function validate3PTCandidate(
  playerName: string,
  actualLine: number,
  l10Avg: number,
  l10Min: number,
  stdDev: number,
  l5Avg: number,
  shootingEfficiencyTier: 'HOT_SHOOTING' | 'NORMAL' | 'COLD_SHOOTING' | null,
  h2hBoost: number
): { passes: boolean; reason: string; tier: 'ELITE' | 'PREMIUM' | 'STANDARD' | 'HOT' | 'BLOCKED' } {
  const varianceTier = stdDev <= 1.0 ? 'LOW' : stdDev <= 1.5 ? 'MEDIUM' : 'HIGH';
  const edge = l10Avg - actualLine;
  const edgeQuality = edge >= 1.0 ? 'FAVORABLE' : edge >= 0.5 ? 'NEUTRAL' : 'TIGHT';

  // DANGER ZONE BLOCKING
  if (varianceTier === 'HIGH' && edgeQuality === 'NEUTRAL') {
    return { passes: false, reason: `HIGH variance + NEUTRAL edge = 0% historical`, tier: 'BLOCKED' };
  }
  if (varianceTier === 'MEDIUM' && edgeQuality === 'TIGHT') {
    return { passes: false, reason: `MEDIUM variance + TIGHT edge = 0% historical`, tier: 'BLOCKED' };
  }

  // FLOOR PROTECTION
  if (edgeQuality === 'TIGHT' && l10Min < THREES_FILTER_CONFIG.MIN_FLOOR_FOR_TIGHT_LINES) {
    return { passes: false, reason: `TIGHT edge requires L10 Min >= 2`, tier: 'BLOCKED' };
  }

  // COLD PLAYER DETECTION (L5 trend)
  if (l5Avg < l10Avg * THREES_FILTER_CONFIG.COLD_STREAK_MULTIPLIER) {
    return { passes: false, reason: `COLD streak: L5 < L10*0.85`, tier: 'BLOCKED' };
  }

  // NEW: COLD SHOOTING EFFICIENCY BLOCK (unless strong H2H)
  if (shootingEfficiencyTier === 'COLD_SHOOTING' && h2hBoost <= 0) {
    return { passes: false, reason: `COLD shooting (L5 3PT% < 30%) without H2H advantage`, tier: 'BLOCKED' };
  }

  // Minimum edge check
  const minEdge = THREES_FILTER_CONFIG.MIN_EDGE_BY_VARIANCE[varianceTier];
  if (edge < minEdge) {
    return { passes: false, reason: `Edge below ${minEdge} for ${varianceTier} variance`, tier: 'BLOCKED' };
  }

  // Maximum variance check
  const maxVariance = THREES_FILTER_CONFIG.MAX_VARIANCE_BY_EDGE[edgeQuality];
  if (stdDev > maxVariance) {
    return { passes: false, reason: `Variance exceeds ${maxVariance} for ${edgeQuality} edge`, tier: 'BLOCKED' };
  }

  // HOT PLAYER (L5 momentum)
  if (l5Avg > l10Avg * THREES_FILTER_CONFIG.HOT_STREAK_MULTIPLIER) {
    return { passes: true, reason: `HOT streak: L5 > L10*1.15`, tier: 'HOT' };
  }

  // NEW: HOT SHOOTING promotes to PREMIUM
  if (shootingEfficiencyTier === 'HOT_SHOOTING' && h2hBoost > 0) {
    return { passes: true, reason: `HOT shooting (L5 3PT% >= 40%) + positive H2H`, tier: 'PREMIUM' };
  }

  // Classify tier
  if (varianceTier === 'LOW') {
    return { passes: true, reason: `LOW variance (100% historical)`, tier: 'ELITE' };
  }
  if (edgeQuality === 'FAVORABLE' && l10Min >= 2) {
    return { passes: true, reason: `Strong floor + favorable edge`, tier: 'PREMIUM' };
  }

  return { passes: true, reason: `Standard pick`, tier: 'STANDARD' };
}

const MIN_HIT_RATE = 0.97; // 97%+ L10 hit rate
const MAX_LEGS = 4; // Optimal 4-leg for threes parlay

export function useEliteThreesBuilder() {
  const { addLeg, clearParlay } = useParlayBuilder();

  const { data: queryResult, isLoading, refetch } = useQuery({
    queryKey: ['elite-threes-parlay'],
    queryFn: async (): Promise<EliteThreesPick[]> => {
      const today = getEasternDate();
      const now = new Date().toISOString();
      
      console.group('🎯 [Elite 3PT Parlay Builder v6.0]');
      console.log(`📅 Target date: ${today}`);

      // Get active props (future games only)
      const { data: activeProps } = await supabase
        .from('unified_props')
        .select('player_name, commence_time')
        .gte('commence_time', now);

      const activePlayerSet = new Set(
        (activeProps || [])
          .filter(p => {
            const propDate = new Date(p.commence_time).toLocaleDateString('en-CA', {
              timeZone: 'America/New_York'
            });
            return propDate === today;
          })
          .map(p => p.player_name?.toLowerCase())
          .filter(Boolean)
      );

      console.log(`👥 Active players in slate: ${activePlayerSet.size}`);

      // Fetch THREE_POINT_SHOOTER picks with 97%+ L10 hit rate
      const { data: threesPicks, error } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .eq('analysis_date', today)
        .eq('category', 'THREE_POINT_SHOOTER')
        .gte('l10_hit_rate', MIN_HIT_RATE)
        .not('actual_line', 'is', null)
        .order('l10_hit_rate', { ascending: false });

      if (error) {
        console.error('Error fetching 3PT picks:', error);
        console.groupEnd();
        return [];
      }

      console.log(`🏀 Raw 3PT picks with 97%+ L10: ${threesPicks?.length || 0}`);

      // Fetch reliability scores to block "avoid" tier players
      const { data: reliabilityScores } = await supabase
        .from('player_reliability_scores')
        .select('player_name, prop_type, reliability_tier, hit_rate, should_block');

      const reliabilityMap = new Map<string, { tier: string; hitRate: number; shouldBlock: boolean }>();
      (reliabilityScores || []).forEach(r => {
        const key = `${r.player_name?.toLowerCase()}_${r.prop_type?.toLowerCase()}`;
        reliabilityMap.set(key, {
          tier: r.reliability_tier || 'unknown',
          hitRate: r.hit_rate || 0,
          shouldBlock: r.should_block || false
        });
      });

      // Fetch H2H matchup data for 3PT (enhanced with worst/best stats)
      const { data: matchupData } = await supabase
        .from('v_3pt_matchup_favorites')
        .select('*');

      const matchupMap = new Map<string, { 
        opponent: string; 
        avgVsTeam: number; 
        tier: string;
        worstVsTeam?: number;
        bestVsTeam?: number;
      }>();
      (matchupData || []).forEach(m => {
        const key = `${m.player_name?.toLowerCase()}_${m.opponent?.toLowerCase()}`;
        matchupMap.set(key, {
          opponent: m.opponent,
          avgVsTeam: m.avg_3pt_vs_team,
          tier: m.matchup_tier,
          worstVsTeam: m.worst_3pt_vs_team,
          bestVsTeam: m.best_3pt_vs_team,
        });
      });

      // Fetch season stats for variance and L5 data
      const { data: seasonStats } = await supabase
        .from('player_season_stats')
        .select('player_name, threes_std_dev, last_5_avg_threes, last_10_avg_threes');

      const varianceMap = new Map<string, number>();
      const l5AvgMap = new Map<string, number>();
      const l10AvgMap = new Map<string, number>();
      (seasonStats || []).forEach(s => {
        const key = s.player_name?.toLowerCase();
        if (key) {
          if (s.threes_std_dev != null) varianceMap.set(key, s.threes_std_dev);
          if (s.last_5_avg_threes != null) l5AvgMap.set(key, s.last_5_avg_threes);
          if (s.last_10_avg_threes != null) l10AvgMap.set(key, s.last_10_avg_threes);
        }
      });

      // Get player team data
      const { data: playerCache } = await supabase
        .from('bdl_player_cache')
        .select('player_name, team_name');

      const teamMap = new Map<string, string>();
      playerCache?.forEach(p => {
        if (p.player_name && p.team_name) {
          teamMap.set(p.player_name.toLowerCase(), p.team_name);
        }
      });

      // Filter and transform picks with v7.0 enhanced validation
      const filteredPicks: EliteThreesPick[] = [];
      const usedTeams = new Set<string>();

      for (const pick of threesPicks || []) {
        const playerKey = pick.player_name?.toLowerCase();
        if (!playerKey) continue;

        // Must be in active slate
        if (!activePlayerSet.has(playerKey)) {
          console.log(`⏭️ Skipping ${pick.player_name} - not in active slate`);
          continue;
        }

        // Check reliability - block "avoid" tier
        const reliabilityKey = `${playerKey}_player_threes`;
        const reliability = reliabilityMap.get(reliabilityKey);
        if (reliability?.shouldBlock) {
          console.log(`🚫 Blocking ${pick.player_name} - reliability shouldBlock flag`);
          continue;
        }

        // Team diversity - max 1 per team
        const team = teamMap.get(playerKey) || 'Unknown';
        if (usedTeams.has(team.toLowerCase())) {
          console.log(`⏭️ Skipping ${pick.player_name} - team ${team} already used`);
          continue;
        }

        // Get variance and L5 data for validation
        const stdDev = varianceMap.get(playerKey) || 2.0;
        const l5Avg = l5AvgMap.get(playerKey) || pick.l10_avg || 0;
        const l10Avg = l10AvgMap.get(playerKey) || pick.l10_avg || 0;
        const actualLine = pick.actual_line || pick.recommended_line || 0;
        const l10Min = pick.l10_min || 0;

        // NEW: Get L5 3PT% from category_sweet_spots if available
        const l5ThreePct = pick.l5_three_pct || null;
        const shootingEfficiencyTier = getShootingEfficiencyTier(l5ThreePct);

        // NEW: Find H2H matchup and calculate boost
        let h2hMatchup: { 
          opponent: string; 
          avgVsTeam: number; 
          tier: string;
          worstVsTeam?: number;
          bestVsTeam?: number;
        } | null = null;
        
        // Look for any matchup for this player (prioritize ELITE)
        for (const [key, value] of matchupMap) {
          if (key.startsWith(playerKey + '_')) {
            if (value.tier === 'ELITE_MATCHUP' || !h2hMatchup) {
              h2hMatchup = value;
              if (value.tier === 'ELITE_MATCHUP') break; // Found best, stop looking
            }
          }
        }

        const h2hBoost = calculateH2HBoost(
          h2hMatchup?.tier || null,
          h2hMatchup?.worstVsTeam || null,
          actualLine
        );

        // v7.0: Apply enhanced variance-edge matrix validation with H2H and efficiency
        const validation = validate3PTCandidate(
          pick.player_name || '',
          actualLine,
          l10Avg,
          l10Min,
          stdDev,
          l5Avg,
          shootingEfficiencyTier,
          h2hBoost
        );

        if (!validation.passes) {
          console.log(`🚫 [3PT Filter] ${pick.player_name}: ${validation.reason}`);
          continue;
        }

        console.log(`✓ [3PT Filter] ${pick.player_name}: ${validation.tier} - ${validation.reason} | H2H: ${h2hBoost > 0 ? '+' : ''}${(h2hBoost * 100).toFixed(0)}% | Shooting: ${shootingEfficiencyTier || 'N/A'}`);

        usedTeams.add(team.toLowerCase());

        const edge = pick.projected_value && actualLine
          ? pick.projected_value - actualLine
          : 0;

        // Get variance tier
        const varianceTier: 'LOW' | 'MEDIUM' | 'HIGH' = 
          stdDev <= 1.0 ? 'LOW' : 
          stdDev <= 1.5 ? 'MEDIUM' : 'HIGH';

        // Calculate enhanced confidence score with H2H boost
        const baseConfidence = pick.confidence_score || 0.8;
        const adjustedConfidence = Math.min(1.0, baseConfidence + h2hBoost);

        filteredPicks.push({
          id: pick.id,
          player_name: pick.player_name || '',
          prop_type: pick.prop_type || 'player_threes',
          line: actualLine,
          side: 'over',
          l10HitRate: pick.l10_hit_rate || 0,
          l10Min: l10Min,
          l10Avg: l10Avg,
          confidenceScore: adjustedConfidence,
          team,
          projectedValue: pick.projected_value,
          edge,
          reliabilityTier: reliability?.tier || null,
          reliabilityHitRate: reliability?.hitRate || null,
          varianceTier,
          qualityTier: validation.tier,
          shootingEfficiencyTier,
          l5ThreePct,
          h2hMatchup: h2hMatchup ? {
            ...h2hMatchup,
            hitRateVsTeam: undefined, // Will be calculated when matchup_history has this data
          } : null,
          h2hBoost,
        });

        if (filteredPicks.length >= MAX_LEGS) break;
      }

      console.log(`✅ Final elite 3PT picks: ${filteredPicks.length}`);
      if (filteredPicks.length > 0) {
        console.table(filteredPicks.map(p => ({
          Player: p.player_name,
          Line: p.line,
          'L10%': `${(p.l10HitRate * 100).toFixed(0)}%`,
          'L10 Min': p.l10Min,
          Team: p.team,
          Variance: p.varianceTier,
          Quality: p.qualityTier,
          Shooting: p.shootingEfficiencyTier || '-',
          'L5 3PT%': p.l5ThreePct ? `${(p.l5ThreePct * 100).toFixed(0)}%` : '-',
          H2H: p.h2hMatchup?.tier || '-',
          'H2H Boost': p.h2hBoost ? `${(p.h2hBoost * 100).toFixed(0)}%` : '-',
          Edge: p.edge?.toFixed(1) || '-',
        })));
      }
      console.groupEnd();

      return filteredPicks;
    },
    staleTime: 60000,
  });

  const eliteThreesPicks = queryResult || [];

  // Calculate combined probability (product of individual hit rates)
  const combinedProbability = eliteThreesPicks.length > 0
    ? eliteThreesPicks.reduce((acc, p) => acc * p.l10HitRate, 1)
    : 0;

  // Calculate theoretical American odds from probability
  const calculateOdds = (prob: number): string => {
    if (prob <= 0) return '-';
    if (prob >= 1) return '-100';
    if (prob >= 0.5) {
      return `-${Math.round((prob / (1 - prob)) * 100)}`;
    } else {
      return `+${Math.round(((1 - prob) / prob) * 100)}`;
    }
  };

  const theoreticalOdds = calculateOdds(combinedProbability);

  // Add elite threes parlay to builder
  const addEliteThreesToBuilder = () => {
    if (eliteThreesPicks.length === 0) {
      toast.error('No elite 3PT picks available');
      return;
    }

    clearParlay();

    eliteThreesPicks.forEach(pick => {
      const description = `${pick.player_name} ${pick.prop_type} OVER ${pick.line}`;
      
      addLeg({
        source: 'sharp',
        description,
        odds: -110,
        playerName: pick.player_name,
        propType: pick.prop_type,
        line: pick.line,
        side: 'over',
        confidenceScore: pick.confidenceScore,
      });
    });

    toast.success(`Added ${eliteThreesPicks.length}-leg Elite 3PT parlay!`);
  };

  return {
    eliteThreesPicks,
    isLoading,
    refetch,
    combinedProbability,
    theoreticalOdds,
    addEliteThreesToBuilder,
    legCount: eliteThreesPicks.length,
    avgL10HitRate: eliteThreesPicks.length > 0
      ? eliteThreesPicks.reduce((sum, p) => sum + p.l10HitRate, 0) / eliteThreesPicks.length
      : 0,
    uniqueTeams: new Set(eliteThreesPicks.map(p => p.team)).size,
  };
}

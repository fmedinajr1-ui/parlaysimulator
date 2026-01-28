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
  h2hMatchup?: {
    opponent: string;
    avgVsTeam: number;
    tier: string;
  } | null;
}

interface EliteThreesResult {
  picks: EliteThreesPick[];
  isLoading: boolean;
  combinedProbability: number;
  theoreticalOdds: string;
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
      
      console.group('🎯 [Elite 3PT Parlay Builder]');
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

      // Fetch H2H matchup data for 3PT
      const { data: matchupData } = await supabase
        .from('v_3pt_matchup_favorites')
        .select('*');

      const matchupMap = new Map<string, { opponent: string; avgVsTeam: number; tier: string }>();
      (matchupData || []).forEach(m => {
        const key = `${m.player_name?.toLowerCase()}_${m.opponent?.toLowerCase()}`;
        matchupMap.set(key, {
          opponent: m.opponent,
          avgVsTeam: m.avg_3pt_vs_team,
          tier: m.matchup_tier
        });
      });

      // Fetch season stats for variance data
      const { data: seasonStats } = await supabase
        .from('player_season_stats')
        .select('player_name, threes_std_dev');

      const varianceMap = new Map<string, number>();
      (seasonStats || []).forEach(s => {
        if (s.player_name && s.threes_std_dev != null) {
          varianceMap.set(s.player_name.toLowerCase(), s.threes_std_dev);
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

      // Filter and transform picks
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

        usedTeams.add(team.toLowerCase());

        const edge = pick.projected_value && pick.actual_line
          ? pick.projected_value - pick.actual_line
          : 0;

        // Get variance tier
        const stdDev = varianceMap.get(playerKey) || 2.0;
        const varianceTier: 'LOW' | 'MEDIUM' | 'HIGH' = 
          stdDev <= 1.0 ? 'LOW' : 
          stdDev <= 1.5 ? 'MEDIUM' : 'HIGH';

        // Find H2H matchup (would need opponent from unified_props)
        // For now, check if player has any elite matchups
        let h2hMatchup: { opponent: string; avgVsTeam: number; tier: string } | null = null;
        for (const [key, value] of matchupMap) {
          if (key.startsWith(playerKey + '_') && value.tier === 'ELITE_MATCHUP') {
            h2hMatchup = value;
            break;
          }
        }

        filteredPicks.push({
          id: pick.id,
          player_name: pick.player_name || '',
          prop_type: pick.prop_type || 'player_threes',
          line: pick.actual_line || pick.recommended_line || 0,
          side: 'over',
          l10HitRate: pick.l10_hit_rate || 0,
          l10Min: pick.l10_min || 0,
          l10Avg: pick.l10_avg || 0,
          confidenceScore: pick.confidence_score || 0.8,
          team,
          projectedValue: pick.projected_value,
          edge,
          reliabilityTier: reliability?.tier || null,
          reliabilityHitRate: reliability?.hitRate || null,
          varianceTier,
          h2hMatchup,
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
          H2H: p.h2hMatchup?.tier || '-',
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

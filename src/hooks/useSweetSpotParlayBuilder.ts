import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useParlayBuilder } from "@/contexts/ParlayBuilderContext";
import { toast } from "sonner";

// Get today's date in Eastern Time for consistent filtering
function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

interface SweetSpotPick {
  id: string;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  confidence_score: number;
  edge: number;
  archetype: string | null;
  team_name?: string;
  event_id?: string;
  game_date?: string;
}

interface DreamTeamLeg {
  pick: SweetSpotPick;
  team: string;
  score: number;
}

// Dream Team constraints
const MAX_PLAYERS_PER_TEAM = 1;
const MAX_PLAYERS_PER_ARCHETYPE = 2;
const MIN_PROP_TYPES = 2;
const TARGET_LEG_COUNT = 6;

export function useSweetSpotParlayBuilder() {
  const { addLeg, clearParlay } = useParlayBuilder();

  // Fetch all sweet spot picks with team data - cross-reference with active props
  const { data: sweetSpotPicks, isLoading, refetch } = useQuery({
    queryKey: ['sweet-spot-parlay-picks'],
    queryFn: async () => {
      const today = getEasternDate();
      const now = new Date().toISOString();
      
      // First get active props (future games only) to filter out stale picks
      const { data: activeProps } = await supabase
        .from('unified_props')
        .select('player_name')
        .gte('commence_time', now);
      
      const activePlayers = new Set(
        (activeProps || []).map(p => p.player_name?.toLowerCase()).filter(Boolean)
      );
      
      console.log(`[SweetSpotParlay] Found ${activePlayers.size} active players with upcoming props`);
      
      // Get sweet spot picks from risk engine
      const { data: riskPicks, error: riskError } = await supabase
        .from('nba_risk_engine_picks')
        .select('*')
        .eq('is_sweet_spot', true)
        .eq('game_date', today)
        .order('confidence_score', { ascending: false });

      if (riskError) {
        console.error('Error fetching risk engine sweet spots:', riskError);
      }

      // Filter to only include picks with active props (games haven't started)
      const validRiskPicks = (riskPicks || []).filter(
        pick => activePlayers.has(pick.player_name?.toLowerCase())
      );
      
      console.log(`[SweetSpotParlay] Filtered ${riskPicks?.length || 0} risk picks to ${validRiskPicks.length} with active props`);

      // Get tracked sweet spot picks
      const { data: trackedPicks, error: trackedError } = await supabase
        .from('sweet_spot_tracking')
        .select('*')
        .is('outcome', null)
        .order('confidence_score', { ascending: false });

      if (trackedError) {
        console.error('Error fetching tracked sweet spots:', trackedError);
      }

      // Filter tracked picks too
      const validTrackedPicks = (trackedPicks || []).filter(
        pick => activePlayers.has(pick.player_name?.toLowerCase())
      );

      // Get player team data from cache
      const { data: playerCache } = await supabase
        .from('bdl_player_cache')
        .select('player_name, team_name');

      const teamMap = new Map<string, string>();
      playerCache?.forEach(p => {
        if (p.player_name && p.team_name) {
          teamMap.set(p.player_name.toLowerCase(), p.team_name);
        }
      });

      // Combine and deduplicate picks
      const allPicks: SweetSpotPick[] = [];
      const seenPlayers = new Set<string>();

      // Add risk engine picks first (higher priority)
      validRiskPicks.forEach(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (playerKey && !seenPlayers.has(playerKey)) {
          seenPlayers.add(playerKey);
          allPicks.push({
            id: pick.id,
            player_name: pick.player_name || '',
            prop_type: pick.prop_type || '',
            line: pick.line || 0,
            side: pick.side || 'over',
            confidence_score: pick.confidence_score || 0,
            edge: pick.edge || 0,
            archetype: pick.archetype,
            team_name: teamMap.get(playerKey) || pick.team_name || 'Unknown',
            event_id: pick.event_id,
            game_date: pick.game_date,
          });
        }
      });

      // Add tracked picks that aren't duplicates
      validTrackedPicks.forEach(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (playerKey && !seenPlayers.has(playerKey)) {
          seenPlayers.add(playerKey);
          allPicks.push({
            id: pick.id,
            player_name: pick.player_name || '',
            prop_type: pick.prop_type || '',
            line: pick.line || 0,
            side: pick.side || 'over',
            confidence_score: pick.confidence_score || 0,
            edge: pick.edge || 0,
            archetype: pick.archetype,
            team_name: teamMap.get(playerKey) || 'Unknown',
          });
        }
      });

      return allPicks;
    },
    staleTime: 60000,
  });

  // Build optimal 6-leg parlay with Dream Team constraints
  const buildOptimalParlay = (): DreamTeamLeg[] => {
    if (!sweetSpotPicks || sweetSpotPicks.length === 0) {
      return [];
    }

    // Score each pick: (confidence * 0.6) + (edge * 0.4)
    const scoredPicks = sweetSpotPicks.map(pick => ({
      pick,
      team: pick.team_name || 'Unknown',
      score: (pick.confidence_score * 0.6) + (Math.min(pick.edge, 10) * 0.4),
    }));

    // Sort by score descending
    scoredPicks.sort((a, b) => b.score - a.score);

    // Apply Dream Team constraints
    const selectedLegs: DreamTeamLeg[] = [];
    const usedTeams = new Set<string>();
    const archetypeCounts = new Map<string, number>();
    const propTypeCounts = new Map<string, number>();

    for (const leg of scoredPicks) {
      if (selectedLegs.length >= TARGET_LEG_COUNT) break;

      const team = leg.team.toLowerCase();
      const archetype = leg.pick.archetype || 'UNKNOWN';
      const propType = leg.pick.prop_type;

      // Check team constraint
      if (usedTeams.has(team)) continue;

      // Check archetype constraint
      const currentArchetypeCount = archetypeCounts.get(archetype) || 0;
      if (currentArchetypeCount >= MAX_PLAYERS_PER_ARCHETYPE) continue;

      // Add to selection
      selectedLegs.push(leg);
      usedTeams.add(team);
      archetypeCounts.set(archetype, currentArchetypeCount + 1);
      propTypeCounts.set(propType, (propTypeCounts.get(propType) || 0) + 1);
    }

    // Validate prop type diversity
    if (propTypeCounts.size < MIN_PROP_TYPES && selectedLegs.length >= MIN_PROP_TYPES) {
      console.warn('Parlay has limited prop type diversity:', propTypeCounts);
    }

    return selectedLegs;
  };

  // Add optimal parlay to builder
  const addOptimalParlayToBuilder = () => {
    const optimalLegs = buildOptimalParlay();
    
    if (optimalLegs.length === 0) {
      toast.error('No sweet spot picks available to build parlay');
      return;
    }

    clearParlay();

    optimalLegs.forEach(leg => {
      const description = `${leg.pick.player_name} ${leg.pick.prop_type} ${leg.pick.side.toUpperCase()} ${leg.pick.line}`;
      
      addLeg({
        source: 'sharp',
        description,
        odds: -110,
        playerName: leg.pick.player_name,
        propType: leg.pick.prop_type,
        line: leg.pick.line,
        side: leg.pick.side as 'over' | 'under',
        confidenceScore: leg.pick.confidence_score,
      });
    });

    toast.success(`Added ${optimalLegs.length}-leg Sweet Spot Dream Team parlay!`);
  };

  const optimalParlay = sweetSpotPicks ? buildOptimalParlay() : [];

  // Calculate combined stats
  const combinedStats = {
    avgConfidence: optimalParlay.length > 0 
      ? optimalParlay.reduce((sum, l) => sum + l.pick.confidence_score, 0) / optimalParlay.length 
      : 0,
    avgEdge: optimalParlay.length > 0 
      ? optimalParlay.reduce((sum, l) => sum + l.pick.edge, 0) / optimalParlay.length 
      : 0,
    uniqueTeams: new Set(optimalParlay.map(l => l.team)).size,
    propTypes: [...new Set(optimalParlay.map(l => l.pick.prop_type))],
    legCount: optimalParlay.length,
  };

  return {
    sweetSpotPicks,
    optimalParlay,
    combinedStats,
    isLoading,
    refetch,
    addOptimalParlayToBuilder,
    buildOptimalParlay,
  };
}

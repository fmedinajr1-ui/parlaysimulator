import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useParlayBuilder } from "@/contexts/ParlayBuilderContext";
import { toast } from "sonner";

// Get today's date in Eastern Time for consistent filtering
function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export interface SweetSpotPick {
  id: string;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  confidence_score: number;
  edge: number;
  archetype: string | null;
  category?: string | null;
  team_name?: string;
  event_id?: string;
  game_date?: string;
  injuryStatus?: string | null;
  l10HitRate?: number | null;
}

export interface DreamTeamLeg {
  pick: SweetSpotPick;
  team: string;
  score: number;
}

// OPTIMAL WINNERS FORMULA v3.0 - Based on user's winning bet slip patterns
// Mirrors $714+ winning parlays: Elite Rebounders + Role Player Props + Unders
// Historical Win Rates from actual winning slips:
// - Elite Reb OVER (Gobert/Nurkic): ~65% win rate
// - Role Player Reb OVER (Finney-Smith/George): ~60% win rate
// - Big Assists OVER (Vucevic): ~70% win rate
// - Low Scorer UNDER (Dort/Sheppard): ~65% win rate
// - Mid Scorer UNDER: 64% win rate
// - Star Floor OVER (Ja Morant): ~75% win rate
const PROVEN_FORMULA = [
  { category: 'ELITE_REB_OVER', side: 'over', count: 1 },      // Gobert/Nurkic type
  { category: 'ROLE_PLAYER_REB', side: 'over', count: 1 },     // Finney-Smith type
  { category: 'BIG_ASSIST_OVER', side: 'over', count: 1 },     // Vucevic type
  { category: 'LOW_SCORER_UNDER', side: 'under', count: 1 },   // Dort/Sheppard type
  { category: 'MID_SCORER_UNDER', side: 'under', count: 1 },   // Nesmith type
  { category: 'STAR_FLOOR_OVER', side: 'over', count: 1 },     // Ja Morant type
];

// Dream Team constraints
const MAX_PLAYERS_PER_TEAM = 1;
const TARGET_LEG_COUNT = 6;

interface SlateStatus {
  currentDate: string;
  displayedDate: string;
  isNextSlate: boolean;
}

interface QueryResult {
  picks: SweetSpotPick[];
  slateStatus: SlateStatus;
}

export function useSweetSpotParlayBuilder() {
  const { addLeg, clearParlay } = useParlayBuilder();

  // Fetch all sweet spot picks with team data - cross-reference with active props and injuries
  const { data: queryResult, isLoading, refetch } = useQuery({
    queryKey: ['sweet-spot-parlay-picks'],
    queryFn: async (): Promise<QueryResult> => {
      const today = getEasternDate();
      const now = new Date().toISOString();
      
      // First get active props (future games only) to filter out stale picks
      const { data: activeProps } = await supabase
        .from('unified_props')
        .select('player_name, commence_time')
        .gte('commence_time', now);
      
      // Check if today has any remaining active games
      const todayActiveProps = (activeProps || []).filter(p => {
        const propDate = new Date(p.commence_time).toLocaleDateString('en-CA', { 
          timeZone: 'America/New_York' 
        });
        return propDate === today;
      });

      // Determine target date - today or next available slate
      let targetDate = today;
      let targetPlayers = new Set(
        todayActiveProps.map(p => p.player_name?.toLowerCase()).filter(Boolean)
      );
      let isNextSlate = false;

      if (todayActiveProps.length === 0 && activeProps && activeProps.length > 0) {
        // Find the earliest future date with props
        const futureProps = (activeProps || [])
          .map(p => ({
            ...p,
            gameDate: new Date(p.commence_time).toLocaleDateString('en-CA', { 
              timeZone: 'America/New_York' 
            })
          }))
          .sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime());

        if (futureProps.length > 0) {
          targetDate = futureProps[0].gameDate;
          targetPlayers = new Set(
            futureProps
              .filter(p => p.gameDate === targetDate)
              .map(p => p.player_name?.toLowerCase())
              .filter(Boolean)
          );
          isNextSlate = true;
          console.log(`[SweetSpotParlay] Today's slate complete. Switching to next slate: ${targetDate}`);
        }
      }

      console.log(`[SweetSpotParlay] Target date: ${targetDate}, Active players: ${targetPlayers.size}`);

      // Fetch injury reports for target date
      const { data: injuryReports } = await supabase
        .from('nba_injury_reports')
        .select('player_name, status, injury_type')
        .eq('game_date', targetDate);

      // Create sets for different injury statuses
      const outPlayers = new Set(
        (injuryReports || [])
          .filter(r => r.status?.toLowerCase().includes('out'))
          .map(r => r.player_name?.toLowerCase())
          .filter(Boolean)
      );

      const questionablePlayers = new Map<string, string>(
        (injuryReports || [])
          .filter(r => !r.status?.toLowerCase().includes('out'))
          .map(r => [r.player_name?.toLowerCase() || '', r.status || ''])
      );

      console.log(`[SweetSpotParlay] Injury check: ${outPlayers.size} OUT, ${questionablePlayers.size} questionable/GTD`);

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

      // Calculate date range (today or yesterday in case of late analysis)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

      // PRIORITY 1: Get OPTIMAL WINNERS from category_sweet_spots (v3.0 categories)
      // Use l10_hit_rate as primary filter - picks with 55%+ L10 hit rate are valid
      const { data: categoryPicks, error: categoryError } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .gte('analysis_date', yesterdayStr)
        .lte('analysis_date', targetDate)
        .in('category', [
          // v3.0 Optimal winners (user's winning patterns)
          'ELITE_REB_OVER', 'ROLE_PLAYER_REB', 'BIG_ASSIST_OVER', 
          'LOW_SCORER_UNDER', 'STAR_FLOOR_OVER',
          // v2.0 Proven winners (still valid)
          'ASSIST_ANCHOR', 'HIGH_REB_UNDER', 'MID_SCORER_UNDER'
        ])
        .or('is_active.eq.true,l10_hit_rate.gte.0.55')  // Active OR high L10 hit rate
        .not('actual_line', 'is', null)  // Must have upcoming game
        .order('l10_hit_rate', { ascending: false });  // Prioritize by L10 hit rate

      if (categoryError) {
        console.error('Error fetching category sweet spots:', categoryError);
      }

      // Filter category picks to active players and exclude OUT injuries
      const validCategoryPicks = (categoryPicks || []).filter(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (!playerKey) return false;
        if (!targetPlayers.has(playerKey)) return false;
        if (outPlayers.has(playerKey)) {
          console.log(`[SweetSpotParlay] Excluding OUT player from categories: ${pick.player_name}`);
          return false;
        }
        return true;
      });

      console.log(`[SweetSpotParlay] Proven category picks: ${validCategoryPicks.length} (from ${categoryPicks?.length || 0})`);

      // PRIORITY 2: Get risk engine picks as fallback
      const { data: riskPicks, error: riskError } = await supabase
        .from('nba_risk_engine_picks')
        .select('*')
        .eq('is_sweet_spot', true)
        .eq('game_date', targetDate)
        .order('confidence_score', { ascending: false });

      if (riskError) {
        console.error('Error fetching risk engine sweet spots:', riskError);
      }

      // Filter risk picks to active players and exclude OUT injuries
      const validRiskPicks = (riskPicks || []).filter(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (!playerKey) return false;
        if (!targetPlayers.has(playerKey)) return false;
        if (outPlayers.has(playerKey)) {
          console.log(`[SweetSpotParlay] Excluding OUT player from risk engine: ${pick.player_name}`);
          return false;
        }
        return true;
      });

      console.log(`[SweetSpotParlay] Risk engine picks: ${validRiskPicks.length} (filtered from ${riskPicks?.length || 0})`);

      // Combine picks with category picks taking priority
      const allPicks: SweetSpotPick[] = [];
      const seenPlayers = new Set<string>();

      // Add category picks first (proven formulas)
      validCategoryPicks.forEach(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (playerKey && !seenPlayers.has(playerKey)) {
          seenPlayers.add(playerKey);
          const injuryStatus = questionablePlayers.get(playerKey) || null;
          
          allPicks.push({
            id: pick.id,
            player_name: pick.player_name || '',
            prop_type: pick.prop_type || '',
            line: pick.actual_line || pick.recommended_line || 0,
            side: pick.recommended_side || 'over',
            confidence_score: pick.confidence_score || 0.8,
            edge: (pick.l10_hit_rate || 0.7) * 10 - 5, // Convert hit rate to edge
            archetype: pick.archetype,
            category: pick.category,
            team_name: teamMap.get(playerKey) || 'Unknown',
            game_date: pick.analysis_date,
            injuryStatus,
            l10HitRate: pick.l10_hit_rate,
          });
        }
      });

      // Add risk engine picks that aren't duplicates
      validRiskPicks.forEach(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (playerKey && !seenPlayers.has(playerKey)) {
          seenPlayers.add(playerKey);
          const injuryStatus = questionablePlayers.get(playerKey) || null;
          
          allPicks.push({
            id: pick.id,
            player_name: pick.player_name || '',
            prop_type: pick.prop_type || '',
            line: pick.line || 0,
            side: pick.side || 'over',
            confidence_score: pick.confidence_score || 0,
            edge: pick.edge || 0,
            archetype: pick.archetype,
            category: null,
            team_name: teamMap.get(playerKey) || pick.team_name || 'Unknown',
            event_id: pick.event_id,
            game_date: pick.game_date,
            injuryStatus,
          });
        }
      });

      return {
        picks: allPicks,
        slateStatus: {
          currentDate: today,
          displayedDate: targetDate,
          isNextSlate,
        }
      };
    },
    staleTime: 60000,
  });

  const sweetSpotPicks = queryResult?.picks;
  const slateStatus = queryResult?.slateStatus || { currentDate: getEasternDate(), displayedDate: getEasternDate(), isNextSlate: false };

  // Build optimal 6-leg parlay prioritizing proven category formulas
  const buildOptimalParlay = (): DreamTeamLeg[] => {
    if (!sweetSpotPicks || sweetSpotPicks.length === 0) {
      return [];
    }

    const selectedLegs: DreamTeamLeg[] = [];
    const usedTeams = new Set<string>();
    const usedPlayers = new Set<string>();

    // Step 1: Fill from proven categories first
    for (const formula of PROVEN_FORMULA) {
      const categoryPicks = sweetSpotPicks
        .filter(p => 
          p.category === formula.category && 
          p.side.toLowerCase() === formula.side &&
          !usedPlayers.has(p.player_name.toLowerCase()) &&
          !usedTeams.has((p.team_name || '').toLowerCase())
        )
        .sort((a, b) => (b.l10HitRate || 0) - (a.l10HitRate || 0)); // Sort by L10 hit rate

      let added = 0;
      for (const pick of categoryPicks) {
        if (added >= formula.count) break;
        if (selectedLegs.length >= TARGET_LEG_COUNT) break;

        const team = (pick.team_name || 'Unknown').toLowerCase();
        
        selectedLegs.push({
          pick,
          team: pick.team_name || 'Unknown',
          score: (pick.confidence_score * 0.4) + ((pick.l10HitRate || 0.7) * 6),
        });
        usedTeams.add(team);
        usedPlayers.add(pick.player_name.toLowerCase());
        added++;
      }

      console.log(`[SweetSpotParlay] Added ${added}/${formula.count} ${formula.category} picks`);
    }

    // Step 2: Fill remaining slots from risk engine picks if needed
    if (selectedLegs.length < TARGET_LEG_COUNT) {
      const remainingPicks = sweetSpotPicks
        .filter(p => 
          !usedPlayers.has(p.player_name.toLowerCase()) &&
          !usedTeams.has((p.team_name || '').toLowerCase())
        )
        .sort((a, b) => b.confidence_score - a.confidence_score);

      for (const pick of remainingPicks) {
        if (selectedLegs.length >= TARGET_LEG_COUNT) break;

        const team = (pick.team_name || 'Unknown').toLowerCase();
        
        selectedLegs.push({
          pick,
          team: pick.team_name || 'Unknown',
          score: (pick.confidence_score * 0.6) + (Math.min(pick.edge, 10) * 0.4),
        });
        usedTeams.add(team);
        usedPlayers.add(pick.player_name.toLowerCase());
      }
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
    avgL10HitRate: optimalParlay.length > 0
      ? optimalParlay.reduce((sum, l) => sum + (l.pick.l10HitRate || 0), 0) / optimalParlay.length
      : 0,
    uniqueTeams: new Set(optimalParlay.map(l => l.team)).size,
    propTypes: [...new Set(optimalParlay.map(l => l.pick.prop_type))],
    legCount: optimalParlay.length,
    categories: [...new Set(optimalParlay.map(l => l.pick.category).filter(Boolean))],
  };

  return {
    sweetSpotPicks,
    optimalParlay,
    combinedStats,
    isLoading,
    refetch,
    addOptimalParlayToBuilder,
    buildOptimalParlay,
    slateStatus,
  };
}

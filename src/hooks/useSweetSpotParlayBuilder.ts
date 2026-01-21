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

// v3.0: ARCHETYPE-PROP ALIGNMENT VALIDATION
const ARCHETYPE_PROP_BLOCKED: Record<string, string[]> = {
  'ELITE_REBOUNDER': ['points', 'threes'],
  'GLASS_CLEANER': ['points', 'threes', 'assists'],
  'RIM_PROTECTOR': ['points', 'threes'],
  'PURE_SHOOTER': ['rebounds', 'blocks'],
  'PLAYMAKER': ['rebounds', 'blocks'],
  'COMBO_GUARD': ['rebounds', 'blocks'],
  'SCORING_GUARD': ['rebounds', 'blocks'],
};

function isPickArchetypeAligned(pick: SweetSpotPick): boolean {
  if (!pick.archetype || pick.archetype === 'UNKNOWN') return true;
  
  const blockedProps = ARCHETYPE_PROP_BLOCKED[pick.archetype];
  if (!blockedProps) return true;
  
  const propLower = pick.prop_type.toLowerCase();
  for (const blocked of blockedProps) {
    if (propLower.includes(blocked)) {
      console.warn(`[SweetSpot] Filtering misaligned: ${pick.player_name} (${pick.archetype}) for ${pick.prop_type}`);
      return false;
    }
  }
  
  return true;
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

  // Fetch all sweet spot picks with team data - cross-reference with active props, injuries, and matchup intelligence
  const { data: queryResult, isLoading, refetch } = useQuery({
    queryKey: ['sweet-spot-parlay-picks'],
    queryFn: async (): Promise<QueryResult> => {
      const today = getEasternDate();
      const now = new Date().toISOString();
      
      // ========== DIAGNOSTIC TRACKING ==========
      const diagnostics = {
        timestamp: new Date().toISOString(),
        targetDate: '',
        totalCandidates: { category: 0, riskEngine: 0 },
        filters: {
          archetypeBlocked: { count: 0, players: [] as string[] },
          matchupBlocked: { count: 0, players: [] as string[] },
          outPlayers: { count: 0, players: [] as string[] },
          sideConflicts: { count: 0, players: [] as string[] },
          notInActiveSlate: { count: 0, players: [] as string[] },
        },
        passedValidation: { category: 0, riskEngine: 0 },
      };
      
      console.group('🎯 [Optimal Parlay Diagnostics]');
      console.log(`📅 Query started at: ${diagnostics.timestamp}`);
      
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
          console.log(`⏭️ Today's slate complete. Switching to next slate: ${targetDate}`);
        }
      }

      diagnostics.targetDate = targetDate;
      console.log(`📆 Target date: ${targetDate}`);
      console.log(`👥 Active players in slate: ${targetPlayers.size}`);

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

      console.log(`🏥 Injuries: ${outPlayers.size} OUT, ${questionablePlayers.size} questionable/GTD`);

      // NEW: Fetch blocked picks from matchup intelligence (head-to-head logic)
      const { data: blockedPicks } = await supabase
        .from('matchup_intelligence')
        .select('player_name, prop_type, side, line, block_reason')
        .eq('game_date', targetDate)
        .eq('is_blocked', true);

      const blockedSet = new Set(
        (blockedPicks || []).map(p => 
          `${p.player_name?.toLowerCase()}_${p.prop_type?.toLowerCase()}_${p.side?.toLowerCase()}`
        )
      );
      
      // Log blocked picks details
      console.log(`🚫 Matchup Intelligence Blocks: ${blockedSet.size}`);
      if (blockedPicks && blockedPicks.length > 0) {
        console.table(blockedPicks.map(p => ({
          player: p.player_name,
          prop: p.prop_type,
          side: p.side,
          reason: p.block_reason
        })));
      }

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
        .or('is_active.eq.true,l10_hit_rate.gte.0.55')
        .not('actual_line', 'is', null)
        .order('l10_hit_rate', { ascending: false });

      if (categoryError) {
        console.error('Error fetching category sweet spots:', categoryError);
      }

      // Build category recommendations map for side enforcement
      const categoryRecommendations = new Map<string, { side: string; l10HitRate: number }>();
      (categoryPicks || []).forEach(pick => {
        const key = `${pick.player_name?.toLowerCase()}_${pick.prop_type?.toLowerCase()}`;
        if (pick.recommended_side) {
          categoryRecommendations.set(key, {
            side: pick.recommended_side.toLowerCase(),
            l10HitRate: pick.l10_hit_rate || 0
          });
        }
      });

      // Filter category picks with ALL validation rules
      const validCategoryPicks = (categoryPicks || []).filter(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (!playerKey) return false;
        if (!targetPlayers.has(playerKey)) return false;
        if (outPlayers.has(playerKey)) {
          console.log(`[SweetSpotParlay] Excluding OUT player from categories: ${pick.player_name}`);
          return false;
        }
        
        // v3.0: Apply archetype alignment check
        if (!isPickArchetypeAligned({
          id: pick.id,
          player_name: pick.player_name || '',
          prop_type: pick.prop_type || '',
          line: pick.actual_line || 0,
          side: pick.recommended_side || 'over',
          confidence_score: pick.confidence_score || 0,
          edge: 0,
          archetype: pick.archetype,
        })) {
          console.log(`[SweetSpotParlay] Blocking archetype-misaligned category: ${pick.player_name} (${pick.archetype}) for ${pick.prop_type}`);
          return false;
        }
        
        // Check matchup intelligence blocking
        const blockKey = `${playerKey}_${pick.prop_type?.toLowerCase()}_${pick.recommended_side?.toLowerCase()}`;
        if (blockedSet.has(blockKey)) {
          console.log(`[SweetSpotParlay] Blocking matchup-blocked category: ${pick.player_name} ${pick.prop_type} ${pick.recommended_side}`);
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

      // Filter risk picks with ALL validation rules
      const validRiskPicks = (riskPicks || []).filter(pick => {
        const playerKey = pick.player_name?.toLowerCase();
        if (!playerKey) return false;
        if (!targetPlayers.has(playerKey)) return false;
        if (outPlayers.has(playerKey)) {
          console.log(`[SweetSpotParlay] Excluding OUT player from risk engine: ${pick.player_name}`);
          return false;
        }
        
        // v3.0: Apply archetype alignment check
        if (!isPickArchetypeAligned({
          id: pick.id,
          player_name: pick.player_name || '',
          prop_type: pick.prop_type || '',
          line: pick.line || 0,
          side: pick.side || 'over',
          confidence_score: pick.confidence_score || 0,
          edge: pick.edge || 0,
          archetype: pick.archetype,
        })) {
          console.log(`[SweetSpotParlay] Blocking archetype-misaligned risk: ${pick.player_name} (${pick.archetype}) for ${pick.prop_type}`);
          return false;
        }
        
        // Check matchup intelligence blocking
        const blockKey = `${playerKey}_${pick.prop_type?.toLowerCase()}_${pick.side?.toLowerCase()}`;
        if (blockedSet.has(blockKey)) {
          console.log(`[SweetSpotParlay] Blocking matchup-blocked risk: ${pick.player_name} ${pick.prop_type} ${pick.side}`);
          return false;
        }
        
        // Check if category has a DIFFERENT side recommendation - skip if conflict
        const catKey = `${playerKey}_${pick.prop_type?.toLowerCase()}`;
        const categoryRec = categoryRecommendations.get(catKey);
        if (categoryRec && categoryRec.side !== pick.side?.toLowerCase()) {
          console.log(`[SweetSpotParlay] Skipping risk pick - category recommends ${categoryRec.side}, risk says ${pick.side}: ${pick.player_name}`);
          return false;
        }
        
        return true;
      });

      console.log(`[SweetSpotParlay] Risk engine picks: ${validRiskPicks.length} (filtered from ${riskPicks?.length || 0})`);

      // Combine picks with category picks taking priority
      const allPicks: SweetSpotPick[] = [];
      const seenPlayers = new Set<string>();

      // Add category picks first (proven formulas) - ALWAYS use recommended_side
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
            side: pick.recommended_side || 'over', // ENFORCE category recommendation
            confidence_score: pick.confidence_score || 0.8,
            edge: (pick.l10_hit_rate || 0.7) * 10 - 5,
            archetype: pick.archetype,
            category: pick.category,
            team_name: teamMap.get(playerKey) || 'Unknown',
            game_date: pick.analysis_date,
            injuryStatus,
            l10HitRate: pick.l10_hit_rate,
          });
        }
      });

      // Add risk engine picks that aren't duplicates and don't conflict with categories
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
    console.group('🏆 [Optimal Parlay Builder v3.0]');
    
    if (!sweetSpotPicks || sweetSpotPicks.length === 0) {
      console.log('❌ No sweet spot picks available');
      console.groupEnd();
      return [];
    }

    console.log(`📊 Total candidates: ${sweetSpotPicks.length}`);
    
    // Track archetype blocks for diagnostics
    const archetypeBlocked: string[] = [];

    // v3.0: Final archetype alignment filter (defense in depth)
    const alignedPicks = sweetSpotPicks.filter(pick => {
      const aligned = isPickArchetypeAligned(pick);
      if (!aligned) {
        archetypeBlocked.push(`${pick.player_name} (${pick.archetype}) → ${pick.prop_type}`);
      }
      return aligned;
    });
    
    if (archetypeBlocked.length > 0) {
      console.log(`🚫 Archetype Blocked (${archetypeBlocked.length}):`);
      archetypeBlocked.forEach(b => console.log(`   ❌ ${b}`));
    }
    
    console.log(`✅ Aligned picks: ${alignedPicks.length}/${sweetSpotPicks.length}`);

    const selectedLegs: DreamTeamLeg[] = [];
    const usedTeams = new Set<string>();
    const usedPlayers = new Set<string>();

    // Step 1: Fill from proven categories first
    for (const formula of PROVEN_FORMULA) {
      const categoryPicks = alignedPicks
        .filter(p => 
          p.category === formula.category && 
          p.side.toLowerCase() === formula.side &&
          !usedPlayers.has(p.player_name.toLowerCase()) &&
          !usedTeams.has((p.team_name || '').toLowerCase())
        )
        .sort((a, b) => (b.l10HitRate || 0) - (a.l10HitRate || 0));

      let added = 0;
      for (const pick of categoryPicks) {
        if (added >= formula.count) break;
        if (selectedLegs.length >= TARGET_LEG_COUNT) break;

        const team = (pick.team_name || 'Unknown').toLowerCase();
        
        console.log(`[Optimal] ✅ SELECTED: ${pick.player_name} ${pick.prop_type} ${pick.side} | Cat: ${pick.category} | Arch: ${pick.archetype || 'N/A'} | L10: ${pick.l10HitRate ? Math.round(pick.l10HitRate * 100) + '%' : 'N/A'}`);
        
        selectedLegs.push({
          pick,
          team: pick.team_name || 'Unknown',
          score: (pick.confidence_score * 0.4) + ((pick.l10HitRate || 0.7) * 6),
        });
        usedTeams.add(team);
        usedPlayers.add(pick.player_name.toLowerCase());
        added++;
      }

      if (added > 0) {
        console.log(`[Optimal] ${formula.category}: Added ${added}/${formula.count}`);
      }
    }

    // Step 2: Fill remaining slots from aligned picks if needed
    if (selectedLegs.length < TARGET_LEG_COUNT) {
      console.log(`[Optimal] Need ${TARGET_LEG_COUNT - selectedLegs.length} more legs, checking remaining picks...`);
      
      const remainingPicks = alignedPicks
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

    // ========== FINAL DIAGNOSTIC SUMMARY ==========
    console.log(`\n📋 FINAL SELECTION (${selectedLegs.length}/${TARGET_LEG_COUNT} legs):`);
    console.table(selectedLegs.map((leg, i) => ({
      '#': i + 1,
      player: leg.pick.player_name,
      prop: `${leg.pick.prop_type} ${leg.pick.side.toUpperCase()} ${leg.pick.line}`,
      category: leg.pick.category || 'Risk Engine',
      archetype: leg.pick.archetype || 'UNKNOWN',
      L10: leg.pick.l10HitRate ? `${Math.round(leg.pick.l10HitRate * 100)}%` : 'N/A',
      team: leg.team,
      score: leg.score.toFixed(2)
    })));
    
    const categoryCount = selectedLegs.filter(l => l.pick.category).length;
    const riskEngineCount = selectedLegs.length - categoryCount;
    console.log(`\n📈 Sources: ${categoryCount} Category picks, ${riskEngineCount} Risk Engine picks`);
    console.groupEnd();

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

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useParlayBuilder } from "@/contexts/ParlayBuilderContext";
import { toast } from "sonner";

interface CategoryPick {
  id: string;
  player_name: string;
  category: string;
  prop_type: string;
  recommended_line: number | null;
  recommended_side: string | null;
  l10_hit_rate: number | null;
  l10_avg: number | null;
  confidence_score: number | null;
}

type CategoryType = 'BIG_REBOUNDER' | 'LOW_LINE_REBOUNDER' | 'NON_SCORING_SHOOTER';

// Target composition: 1 Big + 2 Low Line + 1 Non-Scoring
const CATEGORY_TARGETS: Record<CategoryType, number> = {
  'BIG_REBOUNDER': 1,
  'LOW_LINE_REBOUNDER': 2,
  'NON_SCORING_SHOOTER': 1,
};

export function useCategoryParlayBuilder() {
  const { addLeg, clearParlay } = useParlayBuilder();

  // Fetch category picks that have games today
  const { data: todaysCategoryPicks, isLoading, refetch } = useQuery({
    queryKey: ['category-parlay-picks-today'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];

      // Get today's players from unified_props
      const { data: todaysProps, error: propsError } = await supabase
        .from('unified_props')
        .select('player_name')
        .gte('commence_time', `${today}T00:00:00`)
        .lt('commence_time', `${today}T23:59:59`);

      if (propsError) {
        console.error('Error fetching today\'s props:', propsError);
        return [];
      }

      const todaysPlayers = new Set(
        todaysProps?.map(p => p.player_name?.toLowerCase()).filter(Boolean) || []
      );

      if (todaysPlayers.size === 0) {
        console.log('No players with games today');
        return [];
      }

      // Get category sweet spots
      const { data: categoryPicks, error: categoryError } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .eq('is_active', true)
        .order('l10_hit_rate', { ascending: false });

      if (categoryError) {
        console.error('Error fetching category picks:', categoryError);
        return [];
      }

      // Filter to only players with games today
      const filteredPicks = categoryPicks?.filter(pick => 
        todaysPlayers.has(pick.player_name?.toLowerCase())
      ) || [];

      console.log(`Found ${filteredPicks.length} category picks for today's games`);
      return filteredPicks as CategoryPick[];
    },
    staleTime: 60000,
  });

  // Get picks by category
  const getPicksByCategory = (category: CategoryType): CategoryPick[] => {
    return (todaysCategoryPicks || [])
      .filter(p => p.category === category)
      .sort((a, b) => (b.l10_hit_rate || 0) - (a.l10_hit_rate || 0));
  };

  // Build the 1+2+1 category parlay
  const buildCategoryParlay = () => {
    if (!todaysCategoryPicks || todaysCategoryPicks.length === 0) {
      toast.error('No category picks available for today\'s games');
      return;
    }

    const bigRebounders = getPicksByCategory('BIG_REBOUNDER');
    const lowLineRebounders = getPicksByCategory('LOW_LINE_REBOUNDER');
    const nonScoringShooters = getPicksByCategory('NON_SCORING_SHOOTER');

    const selectedLegs: CategoryPick[] = [];
    const usedPlayers = new Set<string>();

    // Add 1 Big Rebounder
    const bigReb = bigRebounders.find(p => !usedPlayers.has(p.player_name.toLowerCase()));
    if (bigReb) {
      selectedLegs.push(bigReb);
      usedPlayers.add(bigReb.player_name.toLowerCase());
    }

    // Add up to 2 Low Line Rebounders
    for (const lowReb of lowLineRebounders) {
      if (selectedLegs.filter(l => l.category === 'LOW_LINE_REBOUNDER').length >= 2) break;
      if (!usedPlayers.has(lowReb.player_name.toLowerCase())) {
        selectedLegs.push(lowReb);
        usedPlayers.add(lowReb.player_name.toLowerCase());
      }
    }

    // Add 1 Non-Scoring Shooter
    const nonScoring = nonScoringShooters.find(p => !usedPlayers.has(p.player_name.toLowerCase()));
    if (nonScoring) {
      selectedLegs.push(nonScoring);
      usedPlayers.add(nonScoring.player_name.toLowerCase());
    }

    if (selectedLegs.length === 0) {
      toast.error('No valid picks found for category parlay');
      return;
    }

    // Clear existing parlay and add new legs
    clearParlay();

    selectedLegs.forEach(pick => {
      const propType = pick.prop_type === 'rebounds' ? 'REB' : 
                       pick.prop_type === 'points' ? 'PTS' : 
                       pick.prop_type.toUpperCase();
      const side = pick.recommended_side?.toUpperCase() || 'OVER';
      const description = `${pick.player_name} ${propType} ${side} ${pick.recommended_line}`;

      addLeg({
        source: 'hitrate',
        description,
        odds: -110,
        playerName: pick.player_name,
        propType: pick.prop_type,
        line: pick.recommended_line || 0,
        side: (pick.recommended_side || 'over') as 'over' | 'under',
        confidenceScore: pick.confidence_score || 0,
      });
    });

    // Build summary
    const bigCount = selectedLegs.filter(l => l.category === 'BIG_REBOUNDER').length;
    const lowCount = selectedLegs.filter(l => l.category === 'LOW_LINE_REBOUNDER').length;
    const nonCount = selectedLegs.filter(l => l.category === 'NON_SCORING_SHOOTER').length;

    toast.success(`Built ${selectedLegs.length}-leg Category Parlay: ${bigCount} Big + ${lowCount} Low Line + ${nonCount} Non-Scoring`);
  };

  // Get counts per category for today
  const categoryCounts = {
    BIG_REBOUNDER: getPicksByCategory('BIG_REBOUNDER').length,
    LOW_LINE_REBOUNDER: getPicksByCategory('LOW_LINE_REBOUNDER').length,
    NON_SCORING_SHOOTER: getPicksByCategory('NON_SCORING_SHOOTER').length,
  };

  const totalAvailable = Object.values(categoryCounts).reduce((a, b) => a + b, 0);

  return {
    todaysCategoryPicks,
    categoryCounts,
    totalAvailable,
    isLoading,
    refetch,
    buildCategoryParlay,
    getPicksByCategory,
  };
}

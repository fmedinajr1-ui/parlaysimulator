import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useParlayBuilder } from "@/contexts/ParlayBuilderContext";
import { toast } from "sonner";

// Get today's date in Eastern Time for consistent filtering
function getEasternDate(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

interface OversPick {
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

type OversCategory = 'STAR_FLOOR_OVER' | 'HIGH_ASSIST' | 'THREE_POINT_SHOOTER';

// Target composition: 1 Scorer + 1 Playmaker + 1 3PT Shooter
const OVERS_TARGETS: Record<OversCategory, number> = {
  'STAR_FLOOR_OVER': 1,
  'HIGH_ASSIST': 1,
  'THREE_POINT_SHOOTER': 1,
};

// Weighted random selection - higher hit rates have better odds but not guaranteed
const weightedRandomPick = (
  picks: OversPick[], 
  usedPlayers: Set<string>
): OversPick | null => {
  const available = picks.filter(
    p => !usedPlayers.has(p.player_name.toLowerCase())
  );
  if (available.length === 0) return null;
  
  // Weight by hit rate (90% hit rate = weight of 90)
  const weights = available.map(p => (p.l10_hit_rate || 0.5) * 100);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  
  let random = Math.random() * totalWeight;
  for (let i = 0; i < available.length; i++) {
    random -= weights[i];
    if (random <= 0) return available[i];
  }
  
  return available[0];
};

export function useOversParlayBuilder() {
  const { addLeg, clearParlay } = useParlayBuilder();
  
  // Locked picks state with sessionStorage persistence (separate key from category)
  const [lockedPicks, setLockedPicks] = useState<Set<string>>(() => {
    try {
      const saved = sessionStorage.getItem('overs-locked-picks');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Persist locks to sessionStorage
  useEffect(() => {
    if (lockedPicks.size > 0) {
      sessionStorage.setItem('overs-locked-picks', JSON.stringify([...lockedPicks]));
    } else {
      sessionStorage.removeItem('overs-locked-picks');
    }
  }, [lockedPicks]);

  // Toggle lock for a pick by ID
  const toggleLockPick = useCallback((pickId: string) => {
    setLockedPicks(prev => {
      const next = new Set(prev);
      if (next.has(pickId)) {
        next.delete(pickId);
      } else {
        next.add(pickId);
      }
      return next;
    });
  }, []);

  // Clear all locks
  const clearLocks = useCallback(() => setLockedPicks(new Set()), []);

  // Check if pick is locked
  const isLocked = useCallback((pickId: string) => lockedPicks.has(pickId), [lockedPicks]);

  // Fetch OVERS category picks that have games today
  const { data: todaysOversPicks, isLoading, refetch } = useQuery({
    queryKey: ['overs-parlay-picks-today'],
    queryFn: async () => {
      const today = getEasternDate();

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

      // Get OVERS category sweet spots
      const { data: oversPicks, error: oversError } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .eq('is_active', true)
        .in('category', ['STAR_FLOOR_OVER', 'HIGH_ASSIST', 'THREE_POINT_SHOOTER'])
        .order('l10_hit_rate', { ascending: false });

      if (oversError) {
        console.error('Error fetching OVERS picks:', oversError);
        return [];
      }

      // Filter to only players with games today
      const filteredPicks = oversPicks?.filter(pick => 
        todaysPlayers.has(pick.player_name?.toLowerCase())
      ) || [];

      console.log(`Found ${filteredPicks.length} OVERS picks for today's games`);
      return filteredPicks as OversPick[];
    },
    staleTime: 60000,
  });

  // Get picks by category
  const getPicksByCategory = (category: OversCategory): OversPick[] => {
    return (todaysOversPicks || [])
      .filter(p => p.category === category)
      .sort((a, b) => (b.l10_hit_rate || 0) - (a.l10_hit_rate || 0));
  };

  // Build the OVERS parlay (1 Scorer + 1 Playmaker + 1 3PT) with locked picks and weighted random selection
  const buildOversParlay = () => {
    if (!todaysOversPicks || todaysOversPicks.length === 0) {
      toast.error('No OVERS picks available for today\'s games');
      return;
    }

    const scorers = getPicksByCategory('STAR_FLOOR_OVER');
    const playmakers = getPicksByCategory('HIGH_ASSIST');
    const shooters = getPicksByCategory('THREE_POINT_SHOOTER');

    // Get all locked picks first
    const lockedLegs = todaysOversPicks.filter(pick => lockedPicks.has(pick.id));
    
    const usedPlayers = new Set<string>(
      lockedLegs.map(p => p.player_name.toLowerCase())
    );

    // Count locked picks by category
    const lockedScorer = lockedLegs.filter(l => l.category === 'STAR_FLOOR_OVER').length;
    const lockedPlaymaker = lockedLegs.filter(l => l.category === 'HIGH_ASSIST').length;
    const lockedShooter = lockedLegs.filter(l => l.category === 'THREE_POINT_SHOOTER').length;

    const selectedLegs = [...lockedLegs];

    // Fill remaining Scorer slot (need 1 total)
    if (lockedScorer < 1) {
      const pick = weightedRandomPick(scorers, usedPlayers);
      if (pick) {
        selectedLegs.push(pick);
        usedPlayers.add(pick.player_name.toLowerCase());
      }
    }

    // Fill remaining Playmaker slot (need 1 total)
    if (lockedPlaymaker < 1) {
      const pick = weightedRandomPick(playmakers, usedPlayers);
      if (pick) {
        selectedLegs.push(pick);
        usedPlayers.add(pick.player_name.toLowerCase());
      }
    }

    // Fill remaining 3PT Shooter slot (need 1 total)
    if (lockedShooter < 1) {
      const pick = weightedRandomPick(shooters, usedPlayers);
      if (pick) {
        selectedLegs.push(pick);
        usedPlayers.add(pick.player_name.toLowerCase());
      }
    }

    if (selectedLegs.length === 0) {
      toast.error('No valid picks found for OVERS parlay');
      return;
    }

    // Clear existing parlay and add new legs
    clearParlay();

    selectedLegs.forEach(pick => {
      const propType = pick.prop_type === 'points' ? 'PTS' : 
                       pick.prop_type === 'assists' ? 'AST' : 
                       pick.prop_type === 'threes' ? '3PM' :
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
    const scorerCount = selectedLegs.filter(l => l.category === 'STAR_FLOOR_OVER').length;
    const playmakerCount = selectedLegs.filter(l => l.category === 'HIGH_ASSIST').length;
    const shooterCount = selectedLegs.filter(l => l.category === 'THREE_POINT_SHOOTER').length;
    const lockedCount = lockedLegs.length;

    const lockedMsg = lockedCount > 0 ? ` (${lockedCount} locked)` : '';
    toast.success(`Built ${selectedLegs.length}-leg OVERS Parlay: ${scorerCount} PTS + ${playmakerCount} AST + ${shooterCount} 3PM${lockedMsg}`);
  };

  // Get counts per category for today
  const categoryCounts = {
    STAR_FLOOR_OVER: getPicksByCategory('STAR_FLOOR_OVER').length,
    HIGH_ASSIST: getPicksByCategory('HIGH_ASSIST').length,
    THREE_POINT_SHOOTER: getPicksByCategory('THREE_POINT_SHOOTER').length,
  };

  const totalAvailable = Object.values(categoryCounts).reduce((a, b) => a + b, 0);

  return {
    todaysOversPicks,
    categoryCounts,
    totalAvailable,
    isLoading,
    refetch,
    buildOversParlay,
    getPicksByCategory,
    // Lock pick functionality
    lockedPicks,
    toggleLockPick,
    clearLocks,
    isLocked,
  };
}
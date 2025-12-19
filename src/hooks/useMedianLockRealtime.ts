import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface MedianLockCandidate {
  id: string;
  player_name: string;
  team_name: string;
  prop_type: string;
  book_line: number;
  bet_side?: 'OVER' | 'UNDER' | 'PASS';
  classification: 'LOCK' | 'STRONG' | 'BLOCK';
  confidence_score: number;
  hit_rate: number;
  hit_rate_last_5: number;
  median_points: number;
  median_minutes: number;
  raw_edge: number;
  adjusted_edge: number;
  defense_adjustment: number;
  split_edge: number;
  juice_lag_bonus: number;
  is_shock_flagged: boolean;
  shock_reasons: string[];
  shock_passed_validation: boolean;
  passed_checks: string[];
  failed_checks: string[];
  block_reason?: string;
  outcome?: string;
  // Parlay grade flag
  parlay_grade?: boolean;
  // Game status fields
  game_status?: 'scheduled' | 'live' | 'final' | 'postponed';
  game_start_time?: string;
  game_final_time?: string;
  home_team?: string;
  away_team?: string;
  home_score?: number;
  away_score?: number;
  game_clock?: string;
  game_period?: string;
  actual_value?: number;
}

export interface GreenSlip {
  id: string;
  slate_date: string;
  slip_type: '2-leg' | '3-leg';
  legs: Array<{ playerName: string; confidenceScore: number; status: 'LOCK' | 'STRONG' }>;
  slip_score: number;
  probability: number;
  stake_tier: 'A' | 'B' | 'C';
  outcome?: 'won' | 'lost' | 'push' | 'pending';
}

export function useMedianLockRealtime(slateDate: string) {
  const [candidates, setCandidates] = useState<MedianLockCandidate[]>([]);
  const [slips, setSlips] = useState<GreenSlip[]>([]);
  const [loading, setLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Initial data fetch
  const fetchData = useCallback(async () => {
    try {
      const [candidatesRes, slipsRes] = await Promise.all([
        supabase
          .from('median_lock_candidates')
          .select('*')
          .eq('slate_date', slateDate)
          .order('confidence_score', { ascending: false }),
        supabase
          .from('median_lock_slips')
          .select('*')
          .eq('slate_date', slateDate)
          .order('slip_score', { ascending: false }),
      ]);

      if (candidatesRes.data) {
        setCandidates(candidatesRes.data as MedianLockCandidate[]);
      }
      if (slipsRes.data) {
        setSlips(slipsRes.data as unknown as GreenSlip[]);
      }
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error fetching MedianLock data:', error);
    } finally {
      setLoading(false);
    }
  }, [slateDate]);

  // Setup realtime subscription
  useEffect(() => {
    fetchData();

    // Subscribe to candidate changes
    const candidatesChannel = supabase
      .channel(`median-lock-candidates-${slateDate}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'median_lock_candidates',
          filter: `slate_date=eq.${slateDate}`,
        },
        (payload) => {
          console.log('[MedianLock Realtime] Candidate change:', payload.eventType);
          setLastUpdated(new Date());

          if (payload.eventType === 'INSERT') {
            const newCandidate = payload.new as MedianLockCandidate;
            setCandidates(prev => [newCandidate, ...prev]);
            toast.info(`New pick: ${newCandidate.player_name}`);
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as MedianLockCandidate;
            const old = payload.old as Partial<MedianLockCandidate>;
            
            setCandidates(prev =>
              prev.map(c => (c.id === updated.id ? updated : c))
            );

            // Show toast for status changes
            if (old.game_status !== updated.game_status) {
              if (updated.game_status === 'live') {
                toast.info(`🔴 ${updated.player_name} game is LIVE`);
              } else if (updated.game_status === 'final') {
                const outcomeEmoji = updated.outcome === 'hit' ? '✅' : updated.outcome === 'miss' ? '❌' : '⏸️';
                toast.info(`${outcomeEmoji} ${updated.player_name} game FINAL`);
              }
            }

            // Show toast for outcome changes
            if (old.outcome !== updated.outcome && updated.outcome !== 'pending') {
              if (updated.outcome === 'hit') {
                toast.success(`✅ ${updated.player_name} HIT!`);
              } else if (updated.outcome === 'miss') {
                toast.error(`❌ ${updated.player_name} missed`);
              }
            }
          } else if (payload.eventType === 'DELETE') {
            const deleted = payload.old as MedianLockCandidate;
            setCandidates(prev => prev.filter(c => c.id !== deleted.id));
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
        console.log('[MedianLock Realtime] Subscription status:', status);
      });

    // Subscribe to slip changes
    const slipsChannel = supabase
      .channel(`median-lock-slips-${slateDate}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'median_lock_slips',
          filter: `slate_date=eq.${slateDate}`,
        },
        (payload) => {
          console.log('[MedianLock Realtime] Slip change:', payload.eventType);
          setLastUpdated(new Date());

          if (payload.eventType === 'INSERT') {
            setSlips(prev => [payload.new as unknown as GreenSlip, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as unknown as GreenSlip;
            setSlips(prev =>
              prev.map(s => (s.id === updated.id ? updated : s))
            );
          } else if (payload.eventType === 'DELETE') {
            const deleted = payload.old as unknown as GreenSlip;
            setSlips(prev => prev.filter(s => s.id !== deleted.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(candidatesChannel);
      supabase.removeChannel(slipsChannel);
    };
  }, [slateDate, fetchData]);

  // Filter helpers
  const activeCandidates = candidates.filter(
    c => c.game_status !== 'final' && c.outcome !== 'hit' && c.outcome !== 'miss'
  );
  
  const settledCandidates = candidates.filter(
    c => c.game_status === 'final' || c.outcome === 'hit' || c.outcome === 'miss'
  );

  const locks = candidates.filter(c => c.classification === 'LOCK');
  const strongs = candidates.filter(c => c.classification === 'STRONG');
  const shockFlagged = candidates.filter(c => c.is_shock_flagged);

  const activeLocks = activeCandidates.filter(c => c.classification === 'LOCK');
  const activeStrongs = activeCandidates.filter(c => c.classification === 'STRONG');

  const twoLegSlips = slips.filter(s => s.slip_type === '2-leg');
  const threeLegSlips = slips.filter(s => s.slip_type === '3-leg');

  // Stats
  const stats = {
    totalLocks: locks.length,
    totalStrongs: strongs.length,
    activeLocks: activeLocks.length,
    activeStrongs: activeStrongs.length,
    settledCount: settledCandidates.length,
    hitsCount: settledCandidates.filter(c => c.outcome === 'hit').length,
    missesCount: settledCandidates.filter(c => c.outcome === 'miss').length,
    liveGames: candidates.filter(c => c.game_status === 'live').length,
  };

  return {
    candidates,
    slips,
    loading,
    isConnected,
    lastUpdated,
    fetchData,
    // Filtered lists
    activeCandidates,
    settledCandidates,
    locks,
    strongs,
    shockFlagged,
    activeLocks,
    activeStrongs,
    twoLegSlips,
    threeLegSlips,
    // Stats
    stats,
  };
}

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  WhalePick, 
  Sport,
  SignalType,
  Confidence,
  generateInitialMockPicks, 
  generateNewMockPick,
  getLivePicks,
  getWatchlistPicks,
  filterBySport,
  filterByConfidence
} from '@/lib/whaleUtils';

export type TimeWindow = '15m' | '1h' | 'today';
export type ConfidenceFilter = 'A' | 'A+B' | 'ALL';

export interface FeedHealth {
  lastPpSnapshot: Date | null;
  lastBookSnapshot: Date | null;
  propsTracked: number;
  errorCount: number;
  isLive: boolean;
}

interface DbWhalePick {
  id: string;
  market_key: string;
  player_name: string;
  stat_type: string;
  sport: string;
  pp_line: number;
  book_consensus: number | null;
  sharp_score: number;
  confidence: string;
  confidence_grade: string | null;
  pick_side: string;
  matchup: string | null;
  start_time: string;
  expires_at: string;
  created_at: string;
  why_short: string[] | null;
  signal_type: string | null;
  period: string | null;
  divergence_pts: number | null;
  move_speed_pts: number | null;
  confirmation_pts: number | null;
  board_behavior_pts: number | null;
}

// Map database sport keys to display sport names
const SPORT_MAP: Record<string, Sport> = {
  'basketball_nba': 'NBA',
  'basketball_wnba': 'WNBA',
  'hockey_nhl': 'NHL',
  'tennis_atp': 'TENNIS',
  'tennis_wta': 'TENNIS',
};

// Map signal type from database
const SIGNAL_TYPE_MAP: Record<string, SignalType> = {
  'pp_divergence': 'DIVERGENCE',
  'steam': 'STEAM',
  'freeze': 'FREEZE',
  'DIVERGENCE': 'DIVERGENCE',
  'STEAM': 'STEAM',
  'FREEZE': 'FREEZE',
};

// Convert database pick to WhalePick format
function dbToWhalePick(dbPick: DbWhalePick): WhalePick {
  const sport = SPORT_MAP[dbPick.sport] || 'NBA';
  const statType = dbPick.stat_type.replace('player_', '').replace(/_/g, ' ');
  
  // Map confidence grade to our format
  let confidence: Confidence = 'C';
  const grade = dbPick.confidence_grade || dbPick.confidence;
  if (grade === 'A' || grade === 'A+') confidence = 'A';
  else if (grade === 'B') confidence = 'B';
  
  // Build why array from why_short or generate from signal breakdown
  let whyShort = dbPick.why_short || [];
  if (whyShort.length === 0) {
    if (dbPick.divergence_pts && dbPick.divergence_pts >= 20) whyShort.push(`Line divergence detected`);
    if (dbPick.move_speed_pts && dbPick.move_speed_pts >= 10) whyShort.push('Fast line movement');
    if (dbPick.confirmation_pts && dbPick.confirmation_pts >= 10) whyShort.push('Books confirming PP');
    if (dbPick.board_behavior_pts && dbPick.board_behavior_pts > 0) whyShort.push('Board activity');
  }
  
  // Map signal type
  const signalType: SignalType = SIGNAL_TYPE_MAP[dbPick.signal_type || 'DIVERGENCE'] || 'DIVERGENCE';
  
  return {
    id: dbPick.id,
    marketKey: dbPick.market_key,
    playerName: dbPick.player_name,
    matchup: dbPick.matchup || 'TBD vs TBD',
    sport,
    statType: statType.charAt(0).toUpperCase() + statType.slice(1),
    period: dbPick.period || 'Game',
    pickSide: (dbPick.pick_side as 'OVER' | 'UNDER') || 'OVER',
    ppLine: dbPick.pp_line,
    confidence,
    sharpScore: dbPick.sharp_score,
    signalType,
    whyShort,
    startTime: new Date(dbPick.start_time),
    expiresAt: new Date(dbPick.expires_at),
    createdAt: new Date(dbPick.created_at),
    isExpired: new Date(dbPick.expires_at) <= new Date(),
  };
}

export function useWhaleProxy() {
  const [allPicks, setAllPicks] = useState<WhalePick[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [selectedSport, setSelectedSport] = useState<Sport | 'ALL'>('ALL');
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('A+B');
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('1h');
  const [feedHealth, setFeedHealth] = useState<FeedHealth>({
    lastPpSnapshot: null,
    lastBookSnapshot: null,
    propsTracked: 0,
    errorCount: 0,
    isLive: false
  });
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Fetch real picks from database
  const fetchRealPicks = useCallback(async () => {
    try {
      setIsLoading(true);
      
      const { data: picks, error } = await supabase
        .from('whale_picks')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .order('sharp_score', { ascending: false });

      if (error) {
        console.error('Error fetching whale picks:', error);
        setFeedHealth(prev => ({ ...prev, errorCount: prev.errorCount + 1 }));
        return;
      }

      if (picks && picks.length > 0) {
        const whalePicks = picks.map((p) => dbToWhalePick(p as unknown as DbWhalePick));
        setAllPicks(whalePicks);
        
        // Update feed health
        const latestPick = picks[0];
        setFeedHealth({
          lastPpSnapshot: latestPick ? new Date(latestPick.created_at) : null,
          lastBookSnapshot: new Date(),
          propsTracked: picks.length,
          errorCount: 0,
          isLive: true,
        });
      } else {
        setAllPicks([]);
        setFeedHealth(prev => ({
          ...prev,
          propsTracked: 0,
          isLive: true,
        }));
      }
      
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Error in fetchRealPicks:', err);
      setFeedHealth(prev => ({ ...prev, errorCount: prev.errorCount + 1 }));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initialize - fetch real data or mock data
  useEffect(() => {
    if (isSimulating) {
      // Use mock data
      const initialPicks = generateInitialMockPicks(10);
      setAllPicks(initialPicks);
      setFeedHealth(prev => ({
        ...prev,
        lastPpSnapshot: new Date(),
        lastBookSnapshot: new Date(),
        propsTracked: initialPicks.length,
        isLive: true,
      }));
    } else {
      // Fetch real data from database
      fetchRealPicks();
    }
  }, [isSimulating, fetchRealPicks]);

  // Set up real-time subscription for whale_picks
  useEffect(() => {
    if (isSimulating) return;

    const channel = supabase
      .channel('whale_picks_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'whale_picks',
        },
        (payload) => {
          console.log('Whale picks update:', payload);
          // Refetch all picks on any change
          fetchRealPicks();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isSimulating, fetchRealPicks]);

  // Simulation effect - generates new picks every 10 seconds
  useEffect(() => {
    if (!isSimulating) return;

    const interval = setInterval(() => {
      setAllPicks(prev => {
        const now = new Date();
        
        // Mark expired picks
        const updated = prev.map(pick => ({
          ...pick,
          isExpired: pick.expiresAt <= now || pick.startTime <= now
        }));
        
        // Remove old expired picks, keep max 15
        const active = updated.filter(p => !p.isExpired);
        
        // Add 1-2 new picks
        const numNew = 1 + Math.floor(Math.random() * 2);
        const newPicks: WhalePick[] = [];
        for (let i = 0; i < numNew; i++) {
          newPicks.push(generateNewMockPick([...active, ...newPicks]));
        }
        
        const finalPicks = [...active, ...newPicks].slice(-15);
        
        return finalPicks;
      });

      setFeedHealth(prev => ({
        ...prev,
        lastPpSnapshot: new Date(),
        lastBookSnapshot: new Date(Date.now() - Math.random() * 5000),
        propsTracked: Math.floor(50 + Math.random() * 30),
        isLive: true
      }));

      setLastUpdate(new Date());
    }, 10000);

    return () => clearInterval(interval);
  }, [isSimulating]);

  // Auto-refresh real data every 30 seconds
  useEffect(() => {
    if (isSimulating) return;

    const interval = setInterval(() => {
      fetchRealPicks();
    }, 30000);

    return () => clearInterval(interval);
  }, [isSimulating, fetchRealPicks]);

  // Update feed health live status
  useEffect(() => {
    setFeedHealth(prev => ({
      ...prev,
      isLive: isSimulating || prev.propsTracked > 0
    }));
  }, [isSimulating]);

  const toggleSimulation = useCallback(() => {
    setIsSimulating(prev => !prev);
  }, []);

  // Apply filters
  const getFilteredPicks = useCallback(() => {
    let filtered = allPicks;
    
    // Filter by sport
    filtered = filterBySport(filtered, selectedSport);
    
    // Filter by time window
    const now = new Date();
    switch (timeWindow) {
      case '15m':
        filtered = filtered.filter(p => 
          p.createdAt.getTime() > now.getTime() - 15 * 60 * 1000
        );
        break;
      case '1h':
        filtered = filtered.filter(p => 
          p.createdAt.getTime() > now.getTime() - 60 * 60 * 1000
        );
        break;
      // 'today' - show all
    }
    
    return filtered;
  }, [allPicks, selectedSport, timeWindow]);

  // Get live picks (A/B confidence)
  const livePicks = useCallback(() => {
    let filtered = getFilteredPicks();
    filtered = filterByConfidence(filtered, confidenceFilter);
    return getLivePicks(filtered);
  }, [getFilteredPicks, confidenceFilter]);

  // Get watchlist picks (C confidence)
  const watchlistPicks = useCallback(() => {
    const filtered = getFilteredPicks();
    return getWatchlistPicks(filtered);
  }, [getFilteredPicks]);

  // Manual refresh function
  const refresh = useCallback(async () => {
    if (!isSimulating) {
      await fetchRealPicks();
    }
  }, [isSimulating, fetchRealPicks]);

  // Trigger whale-signal-detector and refresh picks
  const triggerRefresh = useCallback(async () => {
    if (isSimulating || isRefreshing) return;
    
    try {
      setIsRefreshing(true);
      
      const { data, error } = await supabase.functions.invoke('whale-signal-detector', {
        method: 'POST',
      });
      
      if (error) {
        console.error('Error triggering whale detector:', error);
        toast.error('Failed to refresh signals');
        return;
      }
      
      console.log('Whale detector result:', data);
      
      await fetchRealPicks();
      
      toast.success(`Refreshed: ${data?.signalsGenerated || 0} signals found`);
    } catch (err) {
      console.error('Error in triggerRefresh:', err);
      toast.error('Failed to refresh signals');
    } finally {
      setIsRefreshing(false);
    }
  }, [isSimulating, isRefreshing, fetchRealPicks]);

  return {
    livePicks: livePicks(),
    watchlistPicks: watchlistPicks(),
    allPicks,
    isSimulating,
    toggleSimulation,
    selectedSport,
    setSelectedSport,
    confidenceFilter,
    setConfidenceFilter,
    timeWindow,
    setTimeWindow,
    feedHealth,
    lastUpdate,
    isLoading,
    refresh,
    isRefreshing,
    triggerRefresh,
  };
}

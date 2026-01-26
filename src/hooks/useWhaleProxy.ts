import { useState, useEffect, useCallback } from 'react';
import { 
  WhalePick, 
  Sport, 
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

  // Initialize with mock data
  useEffect(() => {
    const initialPicks = generateInitialMockPicks(10);
    setAllPicks(initialPicks);
    setFeedHealth(prev => ({
      ...prev,
      lastPpSnapshot: new Date(),
      lastBookSnapshot: new Date(),
      propsTracked: initialPicks.length
    }));
  }, []);

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
        lastBookSnapshot: new Date(Date.now() - Math.random() * 5000), // Slight lag
        propsTracked: Math.floor(50 + Math.random() * 30),
        isLive: true
      }));

      setLastUpdate(new Date());
    }, 10000);

    return () => clearInterval(interval);
  }, [isSimulating]);

  // Update feed health live status
  useEffect(() => {
    setFeedHealth(prev => ({
      ...prev,
      isLive: isSimulating
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
    lastUpdate
  };
}

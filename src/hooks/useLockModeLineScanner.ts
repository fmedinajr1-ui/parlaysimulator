/**
 * Lock Mode Live Line Scanner
 * Scans live book lines for Lock Mode legs and determines optimal bet timing
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { LockModeLeg, PropType, LineStatus, LineTimingStatus } from '@/types/scout-agent';
import { calculateLineFitScore, detectTrapLine } from '@/lib/lockModeEngine';

interface UseLockModeLineScannerOptions {
  scanIntervalMs?: number;
  enabled?: boolean;
}

interface UseLockModeLineScannerResult {
  lineStatuses: Map<string, LineStatus>;
  isScanning: boolean;
  lastScanTime: Date | null;
  optimalLegsCount: number;
  allLegsOptimal: boolean;
  someLegsWaiting: boolean;
  scanNow: () => Promise<void>;
}

// Map PropType to fetch-current-odds prop_type
const propTypeToOddsApiType: Record<PropType, string> = {
  'Points': 'player_points',
  'Rebounds': 'player_rebounds',
  'Assists': 'player_assists',
  'PRA': 'player_points_rebounds_assists',
  'Threes': 'player_threes',
  'Steals': 'player_steals',
  'Blocks': 'player_blocks',
};

export function useLockModeLineScanner(
  legs: LockModeLeg[],
  eventId: string | null,
  sport: string = 'basketball_nba',
  options: UseLockModeLineScannerOptions = {}
): UseLockModeLineScannerResult {
  const {
    scanIntervalMs = 30000, // 30 seconds default
    enabled = true,
  } = options;

  const [lineStatuses, setLineStatuses] = useState<Map<string, LineStatus>>(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  
  const lineMovementHistory = useRef<Map<string, number[]>>(new Map());

  // Generate a unique key for each leg
  const getLegKey = useCallback((leg: LockModeLeg) => {
    return `${leg.player}-${leg.prop}`;
  }, []);

  // Fetch live line for a single leg
  const fetchLiveLineForLeg = useCallback(async (
    leg: LockModeLeg
  ): Promise<LineStatus> => {
    const key = getLegKey(leg);
    
    try {
      const { data, error } = await supabase.functions.invoke('fetch-current-odds', {
        body: {
          event_id: eventId,
          sport,
          player_name: leg.player,
          prop_type: propTypeToOddsApiType[leg.prop] || 'player_points',
          search_all_books: true,
        },
      });

      if (error || !data?.success || !data?.odds) {
        // Return a loading/unavailable status
        return {
          player: leg.player,
          prop: leg.prop,
          originalLine: leg.line,
          liveBookLine: leg.line, // Fall back to original
          lineMovement: 0,
          lineFitScore: 75,
          status: 'LOADING',
          statusReason: 'Unable to fetch live line',
          lastUpdated: new Date(),
          isTrap: false,
        };
      }

      const liveBookLine = data.odds.line;
      const lineMovement = liveBookLine - leg.line;

      // Track movement history for trap detection
      const history = lineMovementHistory.current.get(key) || [];
      history.push(lineMovement);
      if (history.length > 10) history.shift(); // Keep last 10 readings
      lineMovementHistory.current.set(key, history);

      // Calculate fit score and timing status
      const fitResult = calculateLineFitScore(
        leg.projected,
        liveBookLine,
        leg.lean,
        leg.line
      );

      // Check for trap line
      const isTrap = detectTrapLine(
        leg.projected,
        liveBookLine,
        leg.lean,
        history
      );

      // Override status if trap detected
      const finalStatus: LineTimingStatus = isTrap ? 'AVOID' : fitResult.status;
      
      // Build status reason
      let statusReason = '';
      if (isTrap) {
        statusReason = 'Line looks too good - possible trap';
      } else if (lineMovement > 0.5) {
        statusReason = leg.lean === 'OVER' 
          ? `Line moved up ${lineMovement.toFixed(1)} - edge reduced`
          : `Line moved up ${lineMovement.toFixed(1)} - edge improved`;
      } else if (lineMovement < -0.5) {
        statusReason = leg.lean === 'OVER'
          ? `Line dropped ${Math.abs(lineMovement).toFixed(1)} - edge improved`
          : `Line dropped ${Math.abs(lineMovement).toFixed(1)} - edge reduced`;
      } else if (finalStatus === 'BET_NOW') {
        statusReason = 'Optimal entry point';
      } else if (finalStatus === 'WAIT') {
        statusReason = 'Line may improve - hold';
      } else {
        statusReason = 'Edge insufficient';
      }

      return {
        player: leg.player,
        prop: leg.prop,
        originalLine: leg.line,
        liveBookLine,
        lineMovement,
        lineFitScore: fitResult.score,
        status: finalStatus,
        statusReason,
        lastUpdated: new Date(),
        isTrap,
        overPrice: data.odds.over_price,
        underPrice: data.odds.under_price,
        bookmaker: data.odds.bookmaker_title,
      };
    } catch (err) {
      console.error(`[LineScanner] Error fetching line for ${leg.player}:`, err);
      return {
        player: leg.player,
        prop: leg.prop,
        originalLine: leg.line,
        liveBookLine: leg.line,
        lineMovement: 0,
        lineFitScore: 50,
        status: 'LOADING',
        statusReason: 'Error fetching live line',
        lastUpdated: new Date(),
        isTrap: false,
      };
    }
  }, [eventId, sport, getLegKey]);

  // Scan all legs
  const scanNow = useCallback(async () => {
    if (!eventId || legs.length === 0) {
      console.log('[LineScanner] Skipping scan - no eventId or legs');
      return;
    }

    setIsScanning(true);
    console.log(`[LineScanner] Scanning ${legs.length} legs...`);

    try {
      // Fetch all legs in parallel
      const results = await Promise.all(
        legs.map(leg => fetchLiveLineForLeg(leg))
      );

      // Build status map
      const newStatuses = new Map<string, LineStatus>();
      results.forEach(status => {
        const key = getLegKey({ player: status.player, prop: status.prop } as LockModeLeg);
        newStatuses.set(key, status);
      });

      setLineStatuses(newStatuses);
      setLastScanTime(new Date());
      console.log('[LineScanner] Scan complete:', Array.from(newStatuses.values()).map(s => 
        `${s.player} ${s.prop}: ${s.status} (${s.liveBookLine})`
      ));
    } catch (err) {
      console.error('[LineScanner] Scan failed:', err);
    } finally {
      setIsScanning(false);
    }
  }, [eventId, legs, fetchLiveLineForLeg, getLegKey]);

  // Auto-scan on interval
  useEffect(() => {
    if (!enabled || legs.length === 0 || !eventId) {
      return;
    }

    // Initial scan
    scanNow();

    // Set up interval
    const intervalId = setInterval(scanNow, scanIntervalMs);

    return () => {
      clearInterval(intervalId);
    };
  }, [enabled, legs.length, eventId, scanIntervalMs, scanNow]);

  // Compute summary stats
  const statusArray = Array.from(lineStatuses.values());
  const optimalLegsCount = statusArray.filter(s => s.status === 'BET_NOW').length;
  const allLegsOptimal = statusArray.length === legs.length && 
                          statusArray.every(s => s.status === 'BET_NOW');
  const someLegsWaiting = statusArray.some(s => s.status === 'WAIT');

  return {
    lineStatuses,
    isScanning,
    lastScanTime,
    optimalLegsCount,
    allLegsOptimal,
    someLegsWaiting,
    scanNow,
  };
}

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface LineupAlert {
  playerName: string;
  status: string;
  riskLevel: 'critical' | 'high' | 'medium' | 'low' | 'none';
  message: string;
  recommendation: 'AVOID' | 'WAIT' | 'CAUTION' | 'PROCEED';
  injuryNote?: string;
  isStarting?: boolean;
}

interface LineupCheckSummary {
  total: number;
  checked: number;
  critical: number;
  high: number;
  hasRisks: boolean;
  allClear: boolean;
}

interface LineupCheckResult {
  alerts: LineupAlert[];
  summary: LineupCheckSummary;
  checkedAt: string;
}

interface ParlayLeg {
  playerName?: string;
  player?: string;
  propType?: string;
  prop_type?: string;
  line?: number;
  side?: string;
}

export function useLineupCheck() {
  const [isChecking, setIsChecking] = useState(false);
  const [isScraping, setIsScraping] = useState(false);
  const [alerts, setAlerts] = useState<LineupAlert[]>([]);
  const [summary, setSummary] = useState<LineupCheckSummary | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [sources, setSources] = useState<{ espn: number; espn_gameday: number; rotowire: number } | null>(null);

  // Scrape fresh lineup data
  const scrapeLineups = useCallback(async () => {
    setIsScraping(true);
    try {
      const { data, error } = await supabase.functions.invoke('firecrawl-lineup-scraper');
      
      if (error) {
        console.error('[LineupCheck] Scrape error:', error);
        toast.error('Failed to fetch lineups');
        return false;
      }

      if (data?.success) {
        // Track sources
        if (data.sources) {
          setSources(data.sources);
        }
        
        const sourceInfo = data.sources 
          ? `ESPN: ${data.sources.espn}, Game-Day: ${data.sources.espn_gameday}, RotoWire: ${data.sources.rotowire}`
          : '';
        
        toast.success(`Fetched ${data.games} games, ${data.alerts} alerts`, {
          description: sourceInfo || undefined
        });
        return true;
      } else {
        toast.error(data?.error || 'Failed to scrape lineups');
        return false;
      }
    } catch (err) {
      console.error('[LineupCheck] Scrape error:', err);
      toast.error('Failed to fetch lineup data');
      return false;
    } finally {
      setIsScraping(false);
    }
  }, []);

  // Check specific legs against lineup data
  const checkLegs = useCallback(async (legs: ParlayLeg[]) => {
    setIsChecking(true);
    try {
      // Normalize leg format
      const normalizedLegs = legs.map(leg => ({
        playerName: leg.playerName || leg.player || '',
        propType: leg.propType || leg.prop_type || '',
        line: leg.line || 0,
        side: leg.side,
      })).filter(leg => leg.playerName);

      if (normalizedLegs.length === 0) {
        toast.warning('No players to check');
        return null;
      }

      const { data, error } = await supabase.functions.invoke('lineup-cross-reference', {
        body: { legs: normalizedLegs },
      });

      if (error) {
        console.error('[LineupCheck] Cross-reference error:', error);
        toast.error('Failed to check lineups');
        return null;
      }

      if (data?.success) {
        setAlerts(data.alerts || []);
        setSummary(data.summary || null);
        setLastChecked(new Date());

        // Show appropriate toast
        if (data.summary?.critical > 0) {
          toast.error(`⚠️ ${data.summary.critical} player(s) OUT!`, {
            description: 'Critical lineup risks detected',
          });
        } else if (data.summary?.high > 0) {
          toast.warning(`${data.summary.high} player(s) GTD/Questionable`, {
            description: 'Check closer to game time',
          });
        } else if (data.summary?.allClear) {
          toast.success('All players cleared! ✓');
        } else {
          toast.info('Lineup check complete');
        }

        return data as LineupCheckResult;
      }

      return null;
    } catch (err) {
      console.error('[LineupCheck] Error:', err);
      toast.error('Failed to check lineups');
      return null;
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Full check: scrape first, then cross-reference
  const fullCheck = useCallback(async (legs: ParlayLeg[]) => {
    const scraped = await scrapeLineups();
    if (scraped) {
      return await checkLegs(legs);
    }
    return null;
  }, [scrapeLineups, checkLegs]);

  // Clear alerts
  const clearAlerts = useCallback(() => {
    setAlerts([]);
    setSummary(null);
    setLastChecked(null);
    setSources(null);
  }, []);

  // Get alert for specific player
  const getPlayerAlert = useCallback((playerName: string): LineupAlert | undefined => {
    const normalized = playerName.toLowerCase().trim();
    return alerts.find(a => 
      a.playerName.toLowerCase().trim() === normalized ||
      a.playerName.toLowerCase().includes(normalized) ||
      normalized.includes(a.playerName.toLowerCase())
    );
  }, [alerts]);

  return {
    // State
    isChecking,
    isScraping,
    isLoading: isChecking || isScraping,
    alerts,
    summary,
    lastChecked,
    sources,
    hasRisks: summary?.hasRisks || false,
    allClear: summary?.allClear || false,
    
    // Actions
    scrapeLineups,
    checkLegs,
    fullCheck,
    clearAlerts,
    getPlayerAlert,
  };
}

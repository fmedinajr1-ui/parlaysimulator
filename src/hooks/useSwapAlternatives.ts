import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { UniversalLeg } from '@/types/universal-parlay';

export interface SwapAlternative {
  id: string;
  description: string;
  playerName: string;
  propType: string;
  line: number;
  side: 'over' | 'under';
  estimatedOdds: number;
  confidence: number;
  hitRate?: number;
  source: 'median_lock' | 'unified_props' | 'juiced' | 'hitrate';
  reason: string;
  samePlayer: boolean;
  sameGame: boolean;
  comparisonToOriginal: {
    confidenceGain: number;
    oddsChange: number;
    recommendation: 'strong_upgrade' | 'upgrade' | 'slight_upgrade' | 'lateral';
  };
}

export function useSwapAlternatives() {
  const [alternatives, setAlternatives] = useState<SwapAlternative[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const findAlternatives = useCallback(async (leg: UniversalLeg | null) => {
    if (!leg) {
      setAlternatives([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('find-swap-alternatives', {
        body: {
          weakLeg: {
            description: leg.description,
            playerName: leg.playerName,
            propType: leg.propType,
            line: leg.line,
            side: leg.side,
            eventId: leg.eventId,
            sport: leg.sport,
            currentOdds: leg.odds,
          },
          minimumConfidence: 60,
        },
      });

      if (fnError) {
        console.error('Error fetching swap alternatives:', fnError);
        setError(fnError.message);
        setAlternatives([]);
        return;
      }

      setAlternatives(data?.alternatives || []);
    } catch (err) {
      console.error('Failed to fetch swap alternatives:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setAlternatives([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearAlternatives = useCallback(() => {
    setAlternatives([]);
    setError(null);
  }, []);

  return {
    alternatives,
    loading,
    error,
    findAlternatives,
    clearAlternatives,
  };
}

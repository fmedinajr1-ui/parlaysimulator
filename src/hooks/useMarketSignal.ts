import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { MarketSignal } from '@/components/parlay/MarketSignalBadge';

interface UseMarketSignalOptions {
  eventId?: string;
  outcomeName?: string;
  playerName?: string;
}

interface UseMarketSignalResult {
  signal: MarketSignal | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export const useMarketSignal = ({ 
  eventId, 
  outcomeName, 
  playerName 
}: UseMarketSignalOptions): UseMarketSignalResult => {
  const [signal, setSignal] = useState<MarketSignal | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSignal = useCallback(async () => {
    if (!eventId || !outcomeName) {
      setSignal(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('market_signals')
        .select('*')
        .eq('event_id', eventId)
        .eq('outcome_name', outcomeName);

      if (playerName) {
        query = query.eq('player_name', playerName);
      }

      const { data, error: fetchError } = await query.maybeSingle();

      if (fetchError) {
        throw fetchError;
      }

      if (data) {
        setSignal({
          market_score: data.market_score,
          signal_label: data.signal_label as MarketSignal['signal_label'],
          rationale: data.rationale || '',
          line_move_score: data.line_move_score,
          juice_move_score: data.juice_move_score,
          timing_sharpness_score: data.timing_sharpness_score,
          multi_book_consensus_score: data.multi_book_consensus_score,
          public_fade_score: data.public_fade_score,
        });
      } else {
        setSignal(null);
      }
    } catch (err) {
      console.error('Error fetching market signal:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch market signal');
      setSignal(null);
    } finally {
      setIsLoading(false);
    }
  }, [eventId, outcomeName, playerName]);

  useEffect(() => {
    fetchSignal();
  }, [fetchSignal]);

  return {
    signal,
    isLoading,
    error,
    refetch: fetchSignal,
  };
};

// Hook for batch fetching multiple market signals
export const useMarketSignals = (legs: Array<{ eventId?: string; description: string; playerName?: string }>) => {
  const [signals, setSignals] = useState<Map<string, MarketSignal>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchSignals = async () => {
      const eventIds = legs
        .map(leg => leg.eventId)
        .filter((id): id is string => !!id);

      if (eventIds.length === 0) {
        setSignals(new Map());
        return;
      }

      setIsLoading(true);

      try {
        const { data, error } = await supabase
          .from('market_signals')
          .select('*')
          .in('event_id', eventIds);

        if (error) throw error;

        const signalMap = new Map<string, MarketSignal>();
        
        if (data) {
          for (const item of data) {
            const key = `${item.event_id}-${item.outcome_name}-${item.player_name || ''}`;
            signalMap.set(key, {
              market_score: item.market_score,
              signal_label: item.signal_label as MarketSignal['signal_label'],
              rationale: item.rationale || '',
              line_move_score: item.line_move_score,
              juice_move_score: item.juice_move_score,
              timing_sharpness_score: item.timing_sharpness_score,
              multi_book_consensus_score: item.multi_book_consensus_score,
              public_fade_score: item.public_fade_score,
            });
          }
        }

        setSignals(signalMap);
      } catch (err) {
        console.error('Error fetching market signals:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSignals();
  }, [legs]);

  const getSignalForLeg = useCallback((leg: { eventId?: string; description: string; playerName?: string }): MarketSignal | null => {
    if (!leg.eventId) return null;
    
    // Try to find by event + description + player
    const key = `${leg.eventId}-${leg.description}-${leg.playerName || ''}`;
    if (signals.has(key)) return signals.get(key) || null;
    
    // Try without player name
    const keyNoPlayer = `${leg.eventId}-${leg.description}-`;
    if (signals.has(keyNoPlayer)) return signals.get(keyNoPlayer) || null;
    
    // Try to find any signal for this event
    for (const [signalKey, signal] of signals.entries()) {
      if (signalKey.startsWith(leg.eventId)) {
        return signal;
      }
    }
    
    return null;
  }, [signals]);

  return {
    signals,
    isLoading,
    getSignalForLeg,
  };
};

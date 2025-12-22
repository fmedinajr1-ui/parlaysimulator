import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface TrapSignal {
  signal: string;
  points: number;
  reason: string;
  category: 'trap' | 'safe';
}

export interface TrapProbabilityResult {
  trap_probability: number;
  risk_label: 'Low' | 'Medium' | 'High';
  recommendation: 'Play' | 'Reduce Line' | 'Avoid';
  explanation: string;
  triggered_signals: TrapSignal[];
}

interface TrapInput {
  event_id: string;
  outcome_name: string;
  player_name?: string;
  market_type?: string;
  sport?: string;
  opening_odds?: number;
  current_odds?: number;
  opening_line?: number;
  current_line?: number;
  both_sides_moved?: boolean;
  price_only_move?: boolean;
  public_bet_percentage?: number;
  is_primetime?: boolean;
  is_star_player?: boolean;
  has_narrative_angle?: boolean;
  sharp_indicators?: boolean;
  reverse_line_movement?: boolean;
  multi_book_alignment?: boolean;
  is_early_movement?: boolean;
  confirming_books?: number;
}

export function useTrapProbability(leg: TrapInput | null) {
  const [result, setResult] = useState<TrapProbabilityResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leg?.event_id || !leg?.outcome_name) {
      setResult(null);
      return;
    }

    const fetchTrapProbability = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // First check cache
        const { data: cached } = await supabase
          .from('trap_probability_analysis')
          .select('trap_probability, risk_label, recommendation, explanation, triggered_signals')
          .eq('event_id', leg.event_id)
          .eq('outcome_name', leg.outcome_name)
          .single();

        if (cached) {
          setResult({
            trap_probability: cached.trap_probability,
            risk_label: cached.risk_label as 'Low' | 'Medium' | 'High',
            recommendation: cached.recommendation as 'Play' | 'Reduce Line' | 'Avoid',
            explanation: cached.explanation || '',
            triggered_signals: (cached.triggered_signals as unknown as TrapSignal[]) || []
          });
          setIsLoading(false);
          return;
        }

        // Call edge function if not cached
        const { data, error: fnError } = await supabase.functions.invoke('trap-probability-engine', {
          body: { single_leg: leg }
        });

        if (fnError) throw fnError;

        if (data?.results || data?.trap_probability !== undefined) {
          const trapResult = data.results || data;
          setResult({
            trap_probability: trapResult.trap_probability,
            risk_label: trapResult.risk_label,
            recommendation: trapResult.recommendation,
            explanation: trapResult.explanation || '',
            triggered_signals: trapResult.triggered_signals || []
          });
        }
      } catch (err) {
        console.error('Error fetching trap probability:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch trap probability');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTrapProbability();
  }, [leg?.event_id, leg?.outcome_name]);

  return { result, isLoading, error };
}

// Hook for multiple legs
export function useTrapProbabilities(legs: TrapInput[]) {
  const [results, setResults] = useState<Map<string, TrapProbabilityResult>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (legs.length === 0) {
      setResults(new Map());
      return;
    }

    const fetchTrapProbabilities = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: fnError } = await supabase.functions.invoke('trap-probability-engine', {
          body: { legs }
        });

        if (fnError) throw fnError;

        if (data?.results && Array.isArray(data.results)) {
          const newResults = new Map<string, TrapProbabilityResult>();
          
          data.results.forEach((result: TrapProbabilityResult, index: number) => {
            const leg = legs[index];
            const key = `${leg.event_id}_${leg.outcome_name}`;
            newResults.set(key, result);
          });
          
          setResults(newResults);
        }
      } catch (err) {
        console.error('Error fetching trap probabilities:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch trap probabilities');
      } finally {
        setIsLoading(false);
      }
    };

    // Debounce the call
    const timeoutId = setTimeout(fetchTrapProbabilities, 300);
    return () => clearTimeout(timeoutId);
  }, [JSON.stringify(legs.map(l => `${l.event_id}_${l.outcome_name}`))]);

  const getTrapResult = (eventId: string, outcomeName: string): TrapProbabilityResult | undefined => {
    return results.get(`${eventId}_${outcomeName}`);
  };

  return { results, getTrapResult, isLoading, error };
}
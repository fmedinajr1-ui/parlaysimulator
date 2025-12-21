import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface SimilarParlay {
  id: string;
  legCount: number;
  probability: number;
  won: boolean;
  payout: number;
  stake: number;
  createdAt: string;
}

interface ComparisonData {
  similarParlays: {
    totalFound: number;
    matchCriteria: string[];
    winRate: number;
    avgPayout: number;
  };
  benchmarks: {
    userAvg: {
      winRate: number;
      totalParlays: number;
      avgPayout: number;
    };
    communityAvg: {
      winRate: number;
      totalParlays: number;
    };
  };
  comparison: {
    probabilityVsActual: string;
    riskTier: string;
    recommendation: string;
  };
  topSimilarParlays: SimilarParlay[];
}

interface UseHistoricalComparisonProps {
  legCount: number;
  degenerateLevel: string;
  probability: number;
}

export function useHistoricalComparison({ legCount, degenerateLevel, probability }: UseHistoricalComparisonProps) {
  const { user } = useAuth();
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchComparison = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: fnError } = await supabase.functions.invoke('fetch-parlay-comparison', {
          body: {
            legCount,
            degenerateLevel,
            probability,
            userId: user?.id
          }
        });

        if (fnError) {
          console.error('Comparison fetch error:', fnError);
          setError(fnError.message);
          return;
        }

        if (data?.error) {
          setError(data.error);
          return;
        }

        setComparison(data);
      } catch (err) {
        console.error('Failed to fetch comparison:', err);
        setError('Failed to load comparison data');
      } finally {
        setIsLoading(false);
      }
    };

    if (legCount && degenerateLevel && probability) {
      fetchComparison();
    }
  }, [legCount, degenerateLevel, probability, user?.id]);

  return { comparison, isLoading, error };
}

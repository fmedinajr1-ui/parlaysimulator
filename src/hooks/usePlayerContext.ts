import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PlayerContext } from "@/components/results/PlayerNewsContextCard";

interface LegInput {
  legId: string;
  description: string;
  propType?: string;
  line?: number;
  sport?: string;
}

interface UsePlayerContextReturn {
  contexts: Record<string, PlayerContext>;
  isLoading: boolean;
  error: string | null;
  fetchContexts: (legs: LegInput[]) => Promise<void>;
  getContextForLeg: (legId: string) => PlayerContext | null;
}

// Simple in-memory cache
const contextCache = new Map<string, { context: PlayerContext; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export function usePlayerContext(): UsePlayerContextReturn {
  const [contexts, setContexts] = useState<Record<string, PlayerContext>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchInProgress = useRef(false);

  const fetchContexts = useCallback(async (legs: LegInput[]) => {
    if (fetchInProgress.current || legs.length === 0) return;
    
    fetchInProgress.current = true;
    setIsLoading(true);
    setError(null);

    try {
      // Check cache first
      const cachedContexts: Record<string, PlayerContext> = {};
      const legsToFetch: LegInput[] = [];
      const now = Date.now();

      for (const leg of legs) {
        const cacheKey = `${leg.description}-${leg.propType || ''}-${leg.line || ''}`;
        const cached = contextCache.get(cacheKey);
        
        if (cached && (now - cached.timestamp) < CACHE_DURATION) {
          cachedContexts[leg.legId] = cached.context;
        } else {
          legsToFetch.push(leg);
        }
      }

      // Set cached results immediately
      if (Object.keys(cachedContexts).length > 0) {
        setContexts(prev => ({ ...prev, ...cachedContexts }));
      }

      // Fetch remaining from API
      if (legsToFetch.length > 0) {
        const { data, error: fnError } = await supabase.functions.invoke('fetch-player-context', {
          body: { legs: legsToFetch }
        });

        if (fnError) {
          console.error('Error fetching player context:', fnError);
          setError('Failed to load player context');
        } else if (data?.success && data.contexts) {
          // Cache and set new results
          for (const [legId, context] of Object.entries(data.contexts)) {
            const leg = legsToFetch.find(l => l.legId === legId);
            if (leg) {
              const cacheKey = `${leg.description}-${leg.propType || ''}-${leg.line || ''}`;
              contextCache.set(cacheKey, { 
                context: context as PlayerContext, 
                timestamp: now 
              });
            }
          }
          setContexts(prev => ({ ...prev, ...data.contexts }));
        }
      }
    } catch (err) {
      console.error('Error in fetchContexts:', err);
      setError('Failed to load player context');
    } finally {
      setIsLoading(false);
      fetchInProgress.current = false;
    }
  }, []);

  const getContextForLeg = useCallback((legId: string): PlayerContext | null => {
    return contexts[legId] || null;
  }, [contexts]);

  return {
    contexts,
    isLoading,
    error,
    fetchContexts,
    getContextForLeg
  };
}

// Export for use with individual legs
export function usePlayerContextForLeg(leg: LegInput | null) {
  const { contexts, isLoading, error, fetchContexts, getContextForLeg } = usePlayerContext();
  
  useEffect(() => {
    if (leg) {
      fetchContexts([leg]);
    }
  }, [leg?.legId, leg?.description, fetchContexts]);

  return {
    context: leg ? getContextForLeg(leg.legId) : null,
    isLoading,
    error
  };
}

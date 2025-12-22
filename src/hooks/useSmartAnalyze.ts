import { useState, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { usePilotUser } from './usePilotUser';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export type UserRole = 'guest' | 'subscriber' | 'admin';
export type AnalyzeContext = 'homepage' | 'parlay_builder' | 'single_leg' | 'live_game';

interface ParlayLeg {
  eventId?: string;
  playerName?: string;
  propType?: string;
  line?: number;
  side?: string;
  odds?: number;
  sport?: string;
}

interface EngineResult {
  engine: string;
  success: boolean;
  data?: any;
  error?: string;
  executionTime?: number;
}

interface SmartAnalyzeResult {
  context: AnalyzeContext;
  role: UserRole;
  enginesRun: string[];
  results: EngineResult[];
  timestamp: Date;
  totalExecutionTime: number;
}

interface UseSmartAnalyzeOptions {
  legs?: ParlayLeg[];
  eventId?: string;
  sport?: string;
}

const GUEST_ENGINES = ['market-signal-engine'];
const SUBSCRIBER_ENGINES = ['market-signal-engine', 'trap-probability-engine', 'median-lock-engine'];
const ADMIN_ENGINES = [...SUBSCRIBER_ENGINES, 'sharp-engine-v2', 'god-mode-upset-engine', 'coach-tendencies-engine'];

export function useSmartAnalyze(options: UseSmartAnalyzeOptions = {}) {
  const { legs = [], eventId, sport } = options;
  const location = useLocation();
  const { user } = useAuth();
  const { isAdmin, isSubscribed, isPilotUser } = usePilotUser();
  
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<SmartAnalyzeResult | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Detect user role
  const userRole = useMemo((): UserRole => {
    if (isAdmin) return 'admin';
    if (isSubscribed) return 'subscriber';
    return 'guest';
  }, [isAdmin, isSubscribed]);

  // Detect context from route and props
  const analyzeContext = useMemo((): AnalyzeContext => {
    const path = location.pathname;
    
    if (path.includes('/live') || path.includes('/game/')) {
      return 'live_game';
    }
    if (legs.length > 1) {
      return 'parlay_builder';
    }
    if (legs.length === 1 || eventId) {
      return 'single_leg';
    }
    return 'homepage';
  }, [location.pathname, legs.length, eventId]);

  // Get engines based on role
  const getEnginesForRole = useCallback((role: UserRole): string[] => {
    switch (role) {
      case 'admin':
        return ADMIN_ENGINES;
      case 'subscriber':
        return SUBSCRIBER_ENGINES;
      default:
        return GUEST_ENGINES;
    }
  }, []);

  // Get engines based on context
  const getEnginesForContext = useCallback((context: AnalyzeContext, role: UserRole): string[] => {
    const roleEngines = getEnginesForRole(role);
    
    switch (context) {
      case 'homepage':
        // On homepage, run trending/general engines
        return roleEngines.filter(e => 
          ['market-signal-engine', 'median-lock-engine'].includes(e)
        );
      case 'single_leg':
        // For single leg, run leg-specific engines
        return roleEngines.filter(e => 
          ['market-signal-engine', 'trap-probability-engine'].includes(e)
        );
      case 'parlay_builder':
        // For parlay, run all available engines
        return roleEngines;
      case 'live_game':
        // For live games, focus on real-time engines
        return roleEngines.filter(e => 
          ['market-signal-engine', 'sharp-engine-v2'].includes(e)
        );
      default:
        return roleEngines;
    }
  }, [getEnginesForRole]);

  // Build engine-specific payload
  const buildEnginePayload = (engineName: string, basePayload: any): any => {
    switch (engineName) {
      case 'median-lock-engine':
        return { action: 'get_candidates', date: new Date().toISOString().split('T')[0] };
      case 'market-signal-engine':
        return { action: 'scan', ...basePayload };
      case 'trap-probability-engine':
        return { action: 'analyze', ...basePayload };
      case 'sharp-engine-v2':
        return { action: 'analyze', ...basePayload };
      case 'god-mode-upset-engine':
        return { action: 'run' };
      case 'coach-tendencies-engine':
        return { action: 'analyze', ...basePayload };
      default:
        return basePayload;
    }
  };

  // Run a single engine
  const runEngine = async (engineName: string, payload: any): Promise<EngineResult> => {
    const startTime = Date.now();
    try {
      const enginePayload = buildEnginePayload(engineName, payload);
      
      const { data, error } = await supabase.functions.invoke(engineName, {
        body: enginePayload,
      });

      if (error) {
        return {
          engine: engineName,
          success: false,
          error: error.message,
          executionTime: Date.now() - startTime,
        };
      }

      return {
        engine: engineName,
        success: true,
        data,
        executionTime: Date.now() - startTime,
      };
    } catch (err) {
      return {
        engine: engineName,
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        executionTime: Date.now() - startTime,
      };
    }
  };

  // Main analyze function
  const analyze = useCallback(async () => {
    if (isRunning) return;

    setIsRunning(true);
    setProgress(0);
    const startTime = Date.now();

    try {
      const engines = getEnginesForContext(analyzeContext, userRole);
      
      if (engines.length === 0) {
        toast.error('No engines available for your access level');
        return;
      }

      const payload = {
        userId: user?.id,
        context: analyzeContext,
        legs: legs.map(leg => ({
          event_id: leg.eventId,
          player_name: leg.playerName,
          prop_type: leg.propType,
          line: leg.line,
          side: leg.side,
          odds: leg.odds,
          sport: leg.sport,
        })),
        eventId,
        sport,
      };

      const engineResults: EngineResult[] = [];
      const totalEngines = engines.length;

      // Run engines in parallel batches
      const batchSize = 3;
      for (let i = 0; i < engines.length; i += batchSize) {
        const batch = engines.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(engine => runEngine(engine, payload))
        );
        engineResults.push(...batchResults);
        setProgress(Math.round(((i + batch.length) / totalEngines) * 100));
      }

      const result: SmartAnalyzeResult = {
        context: analyzeContext,
        role: userRole,
        enginesRun: engines,
        results: engineResults,
        timestamp: new Date(),
        totalExecutionTime: Date.now() - startTime,
      };

      setResults(result);
      setLastUpdated(new Date());

      const successCount = engineResults.filter(r => r.success).length;
      if (successCount === engineResults.length) {
        toast.success(`Analysis complete! ${successCount} engines processed`);
      } else if (successCount > 0) {
        toast.warning(`Partial success: ${successCount}/${engineResults.length} engines completed`);
      } else {
        toast.error('Analysis failed - please try again');
      }

      return result;
    } catch (err) {
      console.error('Smart analyze error:', err);
      toast.error('Analysis failed');
      return null;
    } finally {
      setIsRunning(false);
      setProgress(100);
    }
  }, [isRunning, analyzeContext, userRole, user?.id, legs, eventId, sport, getEnginesForContext]);

  // Get available engines for display
  const availableEngines = useMemo(() => {
    return getEnginesForContext(analyzeContext, userRole);
  }, [analyzeContext, userRole, getEnginesForContext]);

  return {
    analyze,
    isRunning,
    progress,
    results,
    lastUpdated,
    userRole,
    analyzeContext,
    availableEngines,
  };
}

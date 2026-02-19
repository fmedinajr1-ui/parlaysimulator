import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Progress } from "@/components/ui/progress";
import { usePipelinePreflight } from "@/hooks/usePipelinePreflight";

interface EngineStep {
  name: string;
  function: string;
  body?: object;
}

const ENGINE_STEPS: EngineStep[] = [
  { name: 'Cleaning stale props', function: 'cleanup-stale-props', body: { immediate: true } },
  { name: 'Analyzing categories', function: 'category-props-analyzer', body: { forceRefresh: true } },
  { name: 'Running risk engine', function: 'nba-player-prop-risk-engine', body: { action: 'analyze_slate', mode: 'full_slate' } },
  { name: 'Building sharp parlays', function: 'sharp-parlay-builder' },
  { name: 'Building heat parlays', function: 'heat-prop-engine' },
];

export function SlateRefreshControls() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const queryClient = useQueryClient();
  const { isHealthy, blockers, lastCheckTime, isLoading: preflightLoading } = usePipelinePreflight();

  const invalidateAllQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['sweet-spot-parlay-picks'] });
    queryClient.invalidateQueries({ queryKey: ['sharp-parlays-daily'] });
    queryClient.invalidateQueries({ queryKey: ['heat-parlays-daily'] });
    queryClient.invalidateQueries({ queryKey: ['category-sweet-spots-display'] });
    queryClient.invalidateQueries({ queryKey: ['riskEnginePicks'] });
    queryClient.invalidateQueries({ queryKey: ['sweetSpotTracking'] });
    queryClient.invalidateQueries({ queryKey: ['propEngineV2'] });
    queryClient.invalidateQueries({ queryKey: ['sharpParlays'] });
    queryClient.invalidateQueries({ queryKey: ['heatParlays'] });
    queryClient.invalidateQueries({ queryKey: ['category-sweet-spots-all'] });
    queryClient.invalidateQueries({ queryKey: ['category-parlay-picks-today'] });
  };

  const handleRefreshAllEngines = async () => {
    if (!isHealthy) {
      toast.warning('Pipeline has issues — proceeding anyway. Check blockers above.', { duration: 5000 });
    }
    
    setIsRefreshing(true);
    setCurrentStep(0);
    toast.info('Starting full engine refresh...');
    
    try {
      for (let i = 0; i < ENGINE_STEPS.length; i++) {
        const step = ENGINE_STEPS[i];
        setCurrentStep(i + 1);
        console.log(`[SlateRefresh] Running: ${step.name}`);
        
        const { error } = await supabase.functions.invoke(step.function, {
          body: step.body || {}
        });
        
        if (error) {
          console.error(`[SlateRefresh] ${step.name} error:`, error);
        }
      }
      
      invalidateAllQueries();
      setLastRefresh(new Date());
      toast.success('All engines refreshed! 🎯');
    } catch (err) {
      console.error('[SlateRefresh] Error:', err);
      toast.error('Failed to refresh engines');
    } finally {
      setIsRefreshing(false);
      setCurrentStep(0);
    }
  };

  const progress = isRefreshing ? (currentStep / ENGINE_STEPS.length) * 100 : 0;

  return (
    <div className="space-y-2">
      {/* Preflight Blockers Banner */}
      {!preflightLoading && !isHealthy && blockers.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-3 px-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="text-sm font-semibold text-destructive">
                  {blockers.length} pipeline issue{blockers.length > 1 ? 's' : ''} detected
                </p>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {blockers.map((b, i) => (
                    <li key={i}>• {b}</li>
                  ))}
                </ul>
                {lastCheckTime && (
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Checked {formatDistanceToNow(new Date(lastCheckTime), { addSuffix: true })}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Refresh Controls */}
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-background">
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              {isRefreshing ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-sm font-medium">
                      {ENGINE_STEPS[currentStep - 1]?.name || 'Starting...'}
                    </span>
                  </div>
                  <Progress value={progress} className="h-1.5" />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {lastRefresh ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      <span className="text-sm text-muted-foreground">
                        Updated {formatDistanceToNow(lastRefresh, { addSuffix: true })}
                      </span>
                    </>
                  ) : !preflightLoading && isHealthy ? (
                    <>
                      <ShieldCheck className="h-4 w-4 text-emerald-500" />
                      <span className="text-sm text-muted-foreground">
                        Pipeline healthy — click to generate today's AI parlays
                      </span>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Click to generate today's AI parlays
                    </span>
                  )}
                </div>
              )}
            </div>
            
            <Button 
              variant="neon"
              size="sm"
              onClick={handleRefreshAllEngines}
              disabled={isRefreshing}
              className="gap-2 shrink-0"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Running...' : !isHealthy ? 'Refresh Anyway' : 'Refresh All Engines'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

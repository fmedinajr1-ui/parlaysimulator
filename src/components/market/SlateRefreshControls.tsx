import React, { useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle, ShieldCheck, Zap, Database } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { Progress } from "@/components/ui/progress";
import { usePipelinePreflight } from "@/hooks/usePipelinePreflight";
import { getEasternDate } from "@/lib/dateUtils";

interface PipelineInvokeResponse {
  success?: boolean;
  completed?: boolean;
  run_id?: string;
  warnings?: string[];
  required_failures?: [string, string][];
  optional_failures?: [string, string][];
  diagnostics?: {
    generated_counts?: {
      parlays_total?: number;
      straight_bets_total?: number;
    };
    input_quality?: {
      fresh_fanduel_props_2h?: number;
      pick_pool_candidates?: number;
    };
  };
  will_continue?: boolean;
}

interface EngineStep {
  name: string;
  function?: string;
  body?: object;
  custom?: () => Promise<void>;
}

const ENGINE_STEPS: EngineStep[] = [
  { name: 'Cleaning stale props', function: 'cleanup-stale-props', body: { immediate: true } },
  { name: 'Analyzing categories', function: 'category-props-analyzer', body: { forceRefresh: true } },
  { name: 'Running risk engine', function: 'nba-player-prop-risk-engine', body: { action: 'analyze_slate', mode: 'full_slate' } },
  { name: 'Building sharp parlays', function: 'sharp-parlay-builder', body: { action: 'build' } },
  { name: 'Building heat parlays', function: 'heat-prop-engine', body: { action: 'build' } },
];

export function SlateRefreshControls() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [isL10Refreshing, setIsL10Refreshing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const [currentStepName, setCurrentStepName] = useState('');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const queryClient = useQueryClient();
  const rebuildInProgress = useRef(false);
  const { isHealthy, blockers, lastCheckTime, isLoading: preflightLoading, riskLayerStatus, riskLayerBypassed } = usePipelinePreflight();

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
    setTotalSteps(ENGINE_STEPS.length);
    toast.info('Starting full engine refresh...');
    
    try {
      for (let i = 0; i < ENGINE_STEPS.length; i++) {
        const step = ENGINE_STEPS[i];
        setCurrentStep(i + 1);
        setCurrentStepName(step.name);
        console.log(`[SlateRefresh] Running: ${step.name}`);
        
        const { error } = await supabase.functions.invoke(step.function!, {
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
      setCurrentStepName('');
    }
  };

  const handleCleanAndRebuild = async () => {
    if (rebuildInProgress.current) return; // Debounce guard
    rebuildInProgress.current = true;
    setIsRebuilding(true);
    const today = getEasternDate();

    const CLEAN_REBUILD_STEPS: EngineStep[] = [
      {
        name: 'Syncing fresh game logs',
        function: 'nba-stats-fetcher',
        body: { mode: 'sync', daysBack: 5, useESPN: true, includeParlayPlayers: true },
      },
      {
        name: 'Alerting customers',
        function: 'bot-send-telegram',
        body: { type: 'slate_rebuild_alert', data: {} },
      },
      {
        name: 'Voiding old parlays',
        custom: async () => {
          const { error } = await supabase
            .from('bot_daily_parlays')
            .update({ outcome: 'void', lesson_learned: 'Voided for defense-aware rebuild' })
            .eq('parlay_date', today)
            .or('outcome.eq.pending,outcome.is.null');
          if (error) console.error('[CleanRebuild] Void error:', error);
        },
      },
      { name: 'Cleaning stale props', function: 'cleanup-stale-props', body: { immediate: true } },
      { name: 'Scanning defensive matchups', function: 'bot-matchup-defense-scanner' },
      { name: 'Analyzing categories', function: 'category-props-analyzer', body: { forceRefresh: true } },
      { name: 'Detecting mispriced lines', function: 'detect-mispriced-lines' },
      { name: 'Running risk engine', function: 'nba-player-prop-risk-engine', body: { action: 'analyze_slate', mode: 'full_slate' } },
      { name: 'Quality-gated generation', function: 'bot-quality-regen-loop', body: { target_hit_rate: 35, max_attempts: 3, skip_void: true, adaptive_target: true } },
      { name: 'Running curated pipeline', function: 'bot-curated-pipeline' },
      { name: 'Force fresh mispriced parlays', function: 'bot-force-fresh-parlays' },
      { name: 'Building sharp parlays', function: 'sharp-parlay-builder', body: { action: 'build' } },
      { name: 'Scanning heat tracker', function: 'heat-prop-engine', body: { action: 'scan' } },
      { name: 'Building heat parlays', function: 'heat-prop-engine', body: { action: 'build' } },
      { name: 'Scanning lottery parlays', function: 'nba-mega-parlay-scanner' },
      { name: 'Diversity rebalance', function: 'bot-daily-diversity-rebalance' },
      { name: 'Sending slate status to customers', function: 'bot-slate-status-update' },
    ];

    setTotalSteps(CLEAN_REBUILD_STEPS.length);
    toast.info('🔄 Starting clean slate rebuild...');

    try {
      for (let i = 0; i < CLEAN_REBUILD_STEPS.length; i++) {
        const step = CLEAN_REBUILD_STEPS[i];
        setCurrentStep(i + 1);
        setCurrentStepName(step.name);
        console.log(`[CleanRebuild] Step ${i + 1}/${CLEAN_REBUILD_STEPS.length}: ${step.name}`);

        if (step.custom) {
          await step.custom();
        } else {
          const { error } = await supabase.functions.invoke(step.function!, {
            body: step.body || {},
          });
          if (error) {
            console.error(`[CleanRebuild] ${step.name} error:`, error);
          }
        }
      }

      invalidateAllQueries();
      setLastRefresh(new Date());
      toast.success('Clean rebuild complete! Slate + lottery parlays are live 🎯🎰');
    } catch (err) {
      console.error('[CleanRebuild] Error:', err);
      toast.error('Clean rebuild failed');
    } finally {
      setIsRebuilding(false);
      setCurrentStep(0);
      setCurrentStepName('');
      rebuildInProgress.current = false;
    }
  };

  const handleL10Refresh = async () => {
    setIsL10Refreshing(true);
    setCurrentStep(0);
    setTotalSteps(1);
    setCurrentStepName('Refreshing L10 data & rebuilding all parlays...');
    toast.info('🔄 Starting full L10 refresh + rebuild...');

    try {
      setCurrentStep(1);
      const { data, error } = await supabase.functions.invoke<PipelineInvokeResponse>('refresh-l10-and-rebuild');
      if (error) {
        // Check if it's a timeout/fetch error — pipeline still runs server-side
        const isTimeout = String(error?.message || error).toLowerCase().includes('fetch') 
          || String(error?.message || error).toLowerCase().includes('timeout');
        if (isTimeout) {
          console.warn('[L10Refresh] Client timeout — pipeline still running server-side');
          invalidateAllQueries();
          setLastRefresh(new Date());
          toast.success('Pipeline triggered! Sub-functions are running — check Telegram for results 🚀', { duration: 8000 });
        } else {
          console.error('[L10Refresh] Error:', error);
          toast.error('L10 refresh failed');
        }
      } else {
        invalidateAllQueries();
        setLastRefresh(new Date());
        const parlayCount = data?.diagnostics?.generated_counts?.parlays_total ?? 0;
        const straightBetCount = data?.diagnostics?.generated_counts?.straight_bets_total ?? 0;
        const freshFanDuelProps = data?.diagnostics?.input_quality?.fresh_fanduel_props_2h ?? 0;
        const requiredFailures = data?.required_failures?.length ?? 0;
        const optionalFailures = data?.optional_failures?.length ?? 0;

        if (requiredFailures > 0) {
          toast.error(`Pipeline ran, but required generation failed (${requiredFailures} issue${requiredFailures > 1 ? 's' : ''}).`);
        } else if (parlayCount > 0) {
          const warningSuffix = optionalFailures > 0
            ? ` with ${optionalFailures} warning${optionalFailures > 1 ? 's' : ''}`
            : '';
          toast.success(`Pipeline complete: ${parlayCount} parlays${straightBetCount ? `, ${straightBetCount} straight bets` : ''}${warningSuffix}.`);
        } else if (data?.will_continue) {
          toast.success('Pipeline started and is continuing in the background.');
        } else {
          toast.warning(`Pipeline finished with no new parlays. Fresh FanDuel props: ${freshFanDuelProps}.`);
        }
      }
    } catch (err: any) {
      // Network-level timeout (Failed to fetch)
      const isTimeout = String(err?.message || '').toLowerCase().includes('fetch')
        || String(err?.message || '').toLowerCase().includes('timeout');
      if (isTimeout) {
        console.warn('[L10Refresh] Network timeout — pipeline still running server-side');
        invalidateAllQueries();
        setLastRefresh(new Date());
        toast.success('Pipeline triggered! Sub-functions are running — check Telegram for results 🚀', { duration: 8000 });
      } else {
        console.error('[L10Refresh] Error:', err);
        toast.error('L10 refresh failed');
      }
    } finally {
      setIsL10Refreshing(false);
      setCurrentStep(0);
      setCurrentStepName('');
    }
  };

  const isBusy = isRefreshing || isRebuilding || isL10Refreshing;
  const progress = isBusy && totalSteps > 0 ? (currentStep / totalSteps) * 100 : 0;

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

      {/* Risk Layer Bypass Badge */}
      {!preflightLoading && riskLayerBypassed && (riskLayerStatus === 'empty' || riskLayerStatus === 'thin') && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-2 px-4">
            <div className="flex items-center gap-2 text-xs">
              <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />
              <span className="font-medium text-amber-600 dark:text-amber-400">
                Risk layer bypassed
              </span>
              <span className="text-muted-foreground">
                — risk_layer:{riskLayerStatus} · using sweet spots + raw unified_props
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Refresh Controls */}
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-background">
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              {isBusy ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-sm font-medium">
                      {currentStepName || 'Starting...'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({currentStep}/{totalSteps})
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
            
            <div className="flex items-center gap-2 shrink-0">
              <Button 
                variant="outline"
                size="sm"
                onClick={handleL10Refresh}
                disabled={isBusy}
                className="gap-2"
              >
                <Database className={`h-4 w-4 ${isL10Refreshing ? 'animate-pulse' : ''}`} />
                {isL10Refreshing ? 'Refreshing...' : 'L10 Refresh & Rebuild'}
              </Button>
              <Button 
                variant="destructive"
                size="sm"
                onClick={handleCleanAndRebuild}
                disabled={isBusy}
                className="gap-2"
              >
                <Zap className={`h-4 w-4 ${isRebuilding ? 'animate-pulse' : ''}`} />
                {isRebuilding ? 'Rebuilding...' : 'Clean & Rebuild'}
              </Button>
              <Button 
                variant="neon"
                size="sm"
                onClick={handleRefreshAllEngines}
                disabled={isBusy}
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Running...' : 'Refresh All Engines'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

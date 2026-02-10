/**
 * BotDashboard.tsx
 * 
 * Main dashboard for the autonomous betting bot system.
 * Shows activation progress, parlays, weights, and performance.
 */

import React from 'react';
import { Bot, RefreshCw, Play, CheckCircle, AlertTriangle, TrendingUp } from 'lucide-react';
import { useBotEngine } from '@/hooks/useBotEngine';
import { BotActivationCard } from '@/components/bot/BotActivationCard';
import { BotPnLCalendar } from '@/components/bot/BotPnLCalendar';
import { BotParlayCard } from '@/components/bot/BotParlayCard';
import { CategoryWeightsChart } from '@/components/bot/CategoryWeightsChart';
import { BotPerformanceChart } from '@/components/bot/BotPerformanceChart';
import { LearningLogCard } from '@/components/bot/LearningLogCard';
import { BotNotificationSettings } from '@/components/bot/BotNotificationSettings';
import { BotActivityFeed } from '@/components/bot/BotActivityFeed';
import { BotLearningAnalytics } from '@/components/bot/BotLearningAnalytics';
import { TierBreakdownCard } from '@/components/bot/TierBreakdownCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function BotDashboard() {
  const { toast } = useToast();
  const {
    state,
    generateParlays,
    settleParlays,
    isGenerating,
    isSettling,
    refetch,
  } = useBotEngine();

  const handleGenerate = async () => {
    try {
      const result = await generateParlays();
      toast({
        title: 'Parlays Generated',
        description: `Created ${result?.parlaysGenerated || 0} new parlay(s)`,
      });
    } catch (error) {
      toast({
        title: 'Generation Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleSettle = async () => {
    try {
      const result = await settleParlays();
      toast({
        title: 'Settlement Complete',
        description: `Settled ${result?.parlaysSettled || 0} parlay(s)`,
      });
    } catch (error) {
      toast({
        title: 'Settlement Failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  if (state.isLoading) {
    return (
      <div className="min-h-screen bg-background p-4 pb-32 space-y-4">
        <div className="flex items-center gap-3 mb-6">
          <Bot className="w-8 h-8 text-primary" />
          <h1 className="text-2xl font-bold">Betting Bot</h1>
        </div>
        <div className="grid gap-4">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-32">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={cn(
            "p-2 rounded-xl",
            state.mode === 'real' 
              ? "bg-green-500/20 text-green-400" 
              : "bg-amber-500/20 text-amber-400"
          )}>
            <Bot className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Betting Bot</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant={state.mode === 'real' ? 'default' : 'secondary'}>
                {state.mode === 'real' ? 'Real Mode' : 'Simulation'}
              </Badge>
              {state.isRealModeReady && state.mode === 'simulated' && (
                <Badge variant="outline" className="text-green-400 border-green-400/50">
                  Ready for Real
                </Badge>
              )}
            </div>
          </div>
        </div>
        
        <Button
          variant="ghost"
          size="icon"
          onClick={refetch}
          className="shrink-0"
        >
          <RefreshCw className="w-5 h-5" />
        </Button>
      </div>

      <div className="space-y-6">
        {/* Activation Progress */}
        <BotActivationCard
          consecutiveDays={state.consecutiveProfitDays}
          requiredDays={3}
          simulatedBankroll={state.simulatedBankroll}
          overallWinRate={state.overallWinRate}
          totalParlays={state.totalParlays}
          isRealModeReady={state.isRealModeReady}
        />

        {/* P&L Calendar */}
        <BotPnLCalendar />

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="h-12"
          >
            {isGenerating ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            Generate Parlays
          </Button>
          
          <Button
            variant="secondary"
            onClick={handleSettle}
            disabled={isSettling}
            className="h-12"
          >
            {isSettling ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="w-4 h-4 mr-2" />
            )}
            Settle & Learn
          </Button>
        </div>

        {/* Learning Analytics - NEW */}
        <BotLearningAnalytics />

        {/* Tier Breakdown - NEW */}
        <TierBreakdownCard parlays={state.todayParlays} />

        {/* Today's Parlays */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Today's Bot Parlays</CardTitle>
              <Badge variant="outline">
                {state.todayParlays.length} generated
              </Badge>
            </div>
            <CardDescription>
              Monte Carlo validated picks using {state.activeStrategy?.strategy_name || 'tiered_v2'} strategy
            </CardDescription>
            
            {/* Leg count distribution */}
            {state.todayParlays.length > 0 && (
              <div className="flex gap-2 mt-2 flex-wrap">
                {[3, 4, 5, 6].map(legCount => {
                  const count = state.todayParlays.filter(p => p.leg_count === legCount).length;
                  if (count === 0) return null;
                  return (
                    <Badge 
                      key={legCount} 
                      variant="secondary" 
                      className="text-xs"
                    >
                      {legCount}-Leg ({count})
                    </Badge>
                  );
                })}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {state.todayParlays.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Bot className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No parlays generated yet today</p>
                <p className="text-sm mt-1">Click "Generate Parlays" to create tiered picks (65-75 parlays)</p>
              </div>
            ) : (
              state.todayParlays.slice(0, 10).map((parlay) => (
                <BotParlayCard key={parlay.id} parlay={parlay} />
              ))
            )}
            {state.todayParlays.length > 10 && (
              <p className="text-sm text-muted-foreground text-center pt-2">
                +{state.todayParlays.length - 10} more parlays
              </p>
            )}
          </CardContent>
        </Card>

        {/* Notifications & Activity Row */}
        <div className="grid md:grid-cols-2 gap-4">
          <BotNotificationSettings />
          <BotActivityFeed />
        </div>

        {/* Category Weights */}
        <CategoryWeightsChart weights={state.categoryWeights} />

        {/* Learning Log */}
        <LearningLogCard weights={state.categoryWeights} />

        {/* Performance Chart */}
        <BotPerformanceChart />

        {/* Strategy Info */}
        {state.activeStrategy && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                Active Strategy
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Name</span>
                  <span className="font-medium">{state.activeStrategy.strategy_name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Win Rate</span>
                  <span className={cn(
                    "font-medium",
                    state.activeStrategy.win_rate >= 0.6 ? "text-green-400" : "text-amber-400"
                  )}>
                    {(state.activeStrategy.win_rate * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Times Used</span>
                  <span className="font-medium">{state.activeStrategy.times_used}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">ROI</span>
                  <span className={cn(
                    "font-medium",
                    (state.activeStrategy.roi || 0) >= 0 ? "text-green-400" : "text-red-400"
                  )}>
                    {((state.activeStrategy.roi || 0) * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

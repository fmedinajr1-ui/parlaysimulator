import React from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAdminRole } from '@/hooks/useAdminRole';
import { Bot, RefreshCw, Play, CheckCircle, Settings2, ChevronDown, ChevronUp, Target, Sparkles, Zap, Eye } from 'lucide-react';
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
import { ProfitAuditCard } from '@/components/bot/ProfitAuditCard';
import { TierBreakdownCard } from '@/components/bot/TierBreakdownCard';
import { ResearchSummaryCard } from '@/components/bot/ResearchSummaryCard';
import { ResearchIntelligencePanel } from '@/components/admin/ResearchIntelligencePanel';
import { AdminWarRoomView } from '@/components/admin/AdminWarRoomView';
import { BotQuickStats } from '@/components/bot/BotQuickStats';
import { SimulationAccuracyCard } from '@/components/bot/SimulationAccuracyCard';
import { ShadowPicksFeed } from '@/components/bot/ShadowPicksFeed';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { AppShell } from '@/components/layout/AppShell';

export default function BotDashboard() {
  const { toast } = useToast();
  const { isAdmin, isLoading: adminLoading } = useAdminRole();
  const [showAllParlays, setShowAllParlays] = React.useState(false);
  const {
    state,
    generateParlays,
    smartGenerateParlays,
    settleParlays,
    generateRoundRobin,
    isGenerating,
    isSmartGenerating,
    isSettling,
    isRoundRobinGenerating,
    refetch,
  } = useBotEngine();

  const handleGenerate = async () => {
    try {
      const result = await generateParlays();
      toast({ title: 'Parlays Generated', description: `Created ${result?.parlaysGenerated || 0} new parlay(s)` });
    } catch (error) {
      toast({ title: 'Generation Failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const handleSmartGenerate = async () => {
    try {
      const result = await smartGenerateParlays();
      const analysis = result?.analysis;
      const genCount = result?.generation?.parlaysGenerated || 0;
      toast({ 
        title: '🧠 Smart Generation Complete', 
        description: `Analyzed ${analysis?.totalAnalyzed || 0} historical parlays. Found ${analysis?.hotPatterns || 0} hot patterns. Generated ${genCount} optimized parlay(s).` 
      });
    } catch (error) {
      toast({ title: 'Smart Generation Failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const handleSettle = async () => {
    try {
      const result = await settleParlays();
      toast({ title: 'Settlement Complete', description: `Settled ${result?.parlaysSettled || 0} parlay(s)` });
    } catch (error) {
      toast({ title: 'Settlement Failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const handleRoundRobin = async () => {
    try {
      const result = await generateRoundRobin();
      toast({ 
        title: '🎯 Bankroll Doubler Ready', 
        description: `Created 1 mega-parlay + ${result?.subParlays || 0} round robin combos` 
      });
    } catch (error) {
      toast({ title: 'Doubler Failed', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
    }
  };

  if (adminLoading || state.isLoading) {
    return (
      <AppShell>
        <div className="space-y-4 pb-32">
          <div className="flex items-center gap-3 mb-6">
            <Bot className="w-8 h-8 text-primary" />
            <h1 className="text-2xl font-bold">Betting Bot</h1>
          </div>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AppShell>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  const totalPnL = (state.simulatedBankroll || 1000) - 1000;

  return (
    <AppShell>
    <div className="pb-32">
      {/* Hero Header */}
      <div className="relative rounded-2xl p-4 mb-4 overflow-hidden bg-gradient-to-br from-card via-card to-primary/5 border border-border/50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              'p-2 rounded-xl',
              state.mode === 'real' ? 'bg-green-500/20 text-green-400' : 'bg-primary/20 text-primary'
            )}>
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Betting Bot</h1>
              <Badge variant={state.mode === 'real' ? 'default' : 'secondary'} className="text-[10px] mt-0.5">
                {state.mode === 'real' ? 'Real Mode' : 'Simulation'}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Settings2 className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80" align="end">
                <BotNotificationSettings />
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={refetch}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Quick Stats */}
        <BotQuickStats
          totalPnL={totalPnL}
          winRate={state.overallWinRate}
          streak={state.activationStatus?.consecutive_profitable_days || 0}
          bankroll={state.simulatedBankroll}
        />

        {/* Activation Strip */}
        <div className="mt-3">
          <BotActivationCard
            consecutiveDays={state.consecutiveProfitDays}
            requiredDays={3}
            simulatedBankroll={state.simulatedBankroll}
            overallWinRate={state.overallWinRate}
            totalParlays={state.totalParlays}
            isRealModeReady={state.isRealModeReady}
          />
        </div>
      </div>

      {/* Tabbed Content */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="w-full overflow-x-auto flex">
          <TabsTrigger value="overview" className="flex-1">Overview</TabsTrigger>
          <TabsTrigger value="parlays" className="flex-1">Parlays</TabsTrigger>
          <TabsTrigger value="analytics" className="flex-1">Analytics</TabsTrigger>
          <TabsTrigger value="research" className="flex-1">Research</TabsTrigger>
          <TabsTrigger value="simulation" className="flex-1">Simulation</TabsTrigger>
          <TabsTrigger value="warroom" className="flex-1 gap-1"><Eye className="w-3 h-3" />War Room</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <ResearchSummaryCard />
          <BotPnLCalendar />
          <BotPerformanceChart />
          {state.activeStrategy && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Active Strategy</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{state.activeStrategy.strategy_name}</span>
                  <div className="flex items-center gap-3">
                    <span className={cn('font-medium', state.activeStrategy.win_rate >= 0.6 ? 'text-green-400' : 'text-amber-400')}>
                      {(state.activeStrategy.win_rate * 100).toFixed(0)}% WR
                    </span>
                    <span className={cn('font-medium', (state.activeStrategy.roi || 0) >= 0 ? 'text-green-400' : 'text-red-400')}>
                      {((state.activeStrategy.roi || 0) * 100).toFixed(1)}% ROI
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Parlays Tab */}
        <TabsContent value="parlays" className="space-y-4">
          <TierBreakdownCard parlays={state.todayParlays} />

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Today's Parlays</CardTitle>
                <Badge variant="outline">{state.todayParlays.length} generated</Badge>
              </div>
              <CardDescription>
                {state.activeStrategy?.strategy_name || 'tiered_v2'} strategy
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {state.todayParlays.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Bot className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No parlays yet — hit Generate below</p>
                </div>
              ) : (
                (showAllParlays ? state.todayParlays : state.todayParlays.slice(0, 10)).map((parlay) => (
                  <BotParlayCard key={parlay.id} parlay={parlay} />
                ))
              )}
              {state.todayParlays.length > 10 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => setShowAllParlays(!showAllParlays)}
                >
                  {showAllParlays ? (
                    <>Show less <ChevronUp className="ml-1 h-4 w-4" /></>
                  ) : (
                    <>+{state.todayParlays.length - 10} more <ChevronDown className="ml-1 h-4 w-4" /></>
                  )}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Recent Settled Results */}
          {state.recentSettled.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Recent Results</CardTitle>
                  <Badge variant="outline">
                    {state.recentSettled.filter(p => p.outcome === 'won').length}W - {state.recentSettled.filter(p => p.outcome === 'lost').length}L
                  </Badge>
                </div>
                <CardDescription>Settled parlays from previous days</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {state.recentSettled.map((parlay) => (
                  <BotParlayCard key={parlay.id} parlay={parlay} />
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-4">
          <BotLearningAnalytics />
          <ProfitAuditCard />
          <CategoryWeightsChart weights={state.categoryWeights} />
          <LearningLogCard weights={state.categoryWeights} />
          <BotActivityFeed />
        </TabsContent>

        {/* Research Tab */}
        <TabsContent value="research" className="space-y-4">
          <ResearchIntelligencePanel />
        </TabsContent>

        {/* Simulation Tab */}
        <TabsContent value="simulation" className="space-y-4">
          <SimulationAccuracyCard />
          <ShadowPicksFeed />
        </TabsContent>
        {/* War Room Tab */}
        <TabsContent value="warroom" className="space-y-4">
          <AdminWarRoomView />
        </TabsContent>
      </Tabs>

      {/* Sticky Bottom Action Bar */}
      <div className="fixed bottom-20 left-0 right-0 px-4 z-40">
        <div className="max-w-lg mx-auto flex gap-2 p-2 rounded-2xl bg-card/95 backdrop-blur-md border border-border/50 shadow-lg">
          <Button
            onClick={handleSmartGenerate}
            disabled={isSmartGenerating || isGenerating}
            className="flex-1 h-11 bg-gradient-to-r from-primary to-primary/80"
          >
            {isSmartGenerating ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Smart
          </Button>
          <Button
            variant="outline"
            onClick={handleGenerate}
            disabled={isGenerating || isSmartGenerating}
            className="h-11"
          >
            {isGenerating ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Gen
          </Button>
          <Button
            onClick={handleRoundRobin}
            disabled={isRoundRobinGenerating || isGenerating}
            className="h-11 bg-gradient-to-r from-yellow-600 to-amber-500 hover:from-yellow-500 hover:to-amber-400 text-black font-semibold"
          >
            {isRoundRobinGenerating ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
            Doubler
          </Button>
          <Button
            variant="secondary"
            onClick={handleSettle}
            disabled={isSettling}
            className="h-11"
          >
            {isSettling ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
            Settle
          </Button>
        </div>
      </div>
    </div>
    </AppShell>
  );
}

import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Trophy, XCircle, MinusCircle, TrendingUp, Loader2, RefreshCw, CalendarDays, Target, Zap, Flame, Clock, Archive, Radio } from "lucide-react";
import { usePropResults, PropResult, EngineFilter } from "@/hooks/usePropResults";
import { useArchiveResults } from "@/hooks/useArchiveResults";
import { useLivePropTracking } from "@/hooks/useLivePropTracking";
import { PropResultCard } from "@/components/market/PropResultCard";
import { ParlayResultCard } from "@/components/market/ParlayResultCard";
import { MonthSelector } from "@/components/results/MonthSelector";
import { ArchiveStatsCard } from "@/components/results/ArchiveStatsCard";
import { ArchiveResultCard } from "@/components/results/ArchiveResultCard";
import { cn } from "@/lib/utils";
import { format, parseISO, isToday, isYesterday } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

type OutcomeFilter = 'all' | 'hit' | 'miss' | 'push' | 'pending';
type ViewMode = 'live' | 'archive';

function formatDateHeader(dateStr: string): string {
  const date = parseISO(dateStr);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE, MMMM d, yyyy');
}

export default function PropResults() {
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all');
  const [engineFilter, setEngineFilter] = useState<EngineFilter>('all');
  const [isVerifying, setIsVerifying] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('live');
  const [selectedMonth, setSelectedMonth] = useState(new Date());
  
  const queryClient = useQueryClient();
  const { data: results, isLoading, stats, groupedByDate } = usePropResults(14);
  const { results: archiveResults, stats: archiveStats, groupedByDate: archiveGroupedByDate, isLoading: archiveLoading } = useArchiveResults(selectedMonth);
  
  // Get all pending picks for live tracking
  const pendingPicks = useMemo(() => 
    results?.filter(r => r.outcome === 'pending' || r.outcome === 'partial') || [], 
    [results]
  );
  const { propsWithLiveData, livePropsCount } = useLivePropTracking(pendingPicks);
  
  // Create a map for quick lookup of live data by prop ID
  const liveDataMap = useMemo(() => {
    const map = new Map<string, typeof propsWithLiveData[0]['liveData']>();
    propsWithLiveData.forEach(({ prop, liveData }) => {
      if (liveData) {
        map.set(prop.id, liveData);
      }
    });
    return map;
  }, [propsWithLiveData]);

  const handleSyncAndVerify = async () => {
    setIsVerifying(true);
    try {
      // Step 1: Sync game stats from ESPN
      toast.info("Step 1/2: Syncing game stats...");
      const syncResult = await supabase.functions.invoke('nba-stats-fetcher', {
        body: { mode: 'sync', daysBack: 1, useESPN: true }
      });
      
      if (syncResult.error) {
        toast.error('Failed to sync game stats');
        return;
      }
      
      const statsCount = syncResult.data?.espnStats?.length || syncResult.data?.totalGameLogs || 0;
      toast.success(`Synced ${statsCount} game logs`);

      // Step 2: Verify outcomes
      toast.info("Step 2/2: Verifying outcomes...");
      const { data, error } = await supabase.functions.invoke('verify-all-engine-outcomes');
      
      if (error) throw error;
      
      if (data.success) {
        const { summary } = data;
        toast.success(`Verified ${summary.verified}: ${summary.hits}W - ${summary.misses}L - ${summary.pushes}P`);
        queryClient.invalidateQueries({ queryKey: ['prop-results'] });
      } else {
        toast.error(data.error || 'Verification failed');
      }
    } catch (error) {
      console.error('Sync & verify error:', error);
      toast.error('Failed to sync and verify');
    } finally {
      setIsVerifying(false);
    }
  };

  // Filter results by outcome and engine
  const filteredGrouped = Object.entries(groupedByDate).reduce((acc, [date, picks]) => {
    let filtered = picks;
    
    // Apply engine filter
    if (engineFilter !== 'all') {
      filtered = filtered.filter(p => p.source === engineFilter);
    }
    
    // Apply outcome filter
    if (outcomeFilter === 'pending') {
      filtered = filtered.filter(p => p.outcome === 'partial' || p.outcome === 'pending');
    } else if (outcomeFilter !== 'all') {
      filtered = filtered.filter(p => p.outcome === outcomeFilter);
    }
    
    if (filtered.length > 0) {
      acc[date] = filtered;
    }
    return acc;
  }, {} as Record<string, PropResult[]>);

  const sortedDates = Object.keys(filteredGrouped).sort((a, b) => 
    parseISO(b).getTime() - parseISO(a).getTime()
  );

  // Archive filtered and sorted dates
  const archiveSortedDates = Object.keys(archiveGroupedByDate).sort((a, b) => 
    parseISO(b).getTime() - parseISO(a).getTime()
  );

  // Calculate filtered stats
  const filteredStats = engineFilter === 'all' ? stats : {
    totalWins: stats.byEngine[engineFilter].wins,
    totalLosses: stats.byEngine[engineFilter].losses,
    totalPushes: stats.byEngine[engineFilter].pushes,
    totalSettled: stats.byEngine[engineFilter].wins + stats.byEngine[engineFilter].losses + stats.byEngine[engineFilter].pushes,
    winRate: (stats.byEngine[engineFilter].wins + stats.byEngine[engineFilter].losses) > 0
      ? (stats.byEngine[engineFilter].wins / (stats.byEngine[engineFilter].wins + stats.byEngine[engineFilter].losses)) * 100
      : 0,
  };

  return (
    <div className="min-h-screen bg-background pb-6">
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link to="/prop-market">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Trophy className="w-6 h-6 text-primary" />
              <h1 className="text-2xl font-bold">Prop Results</h1>
            </div>
          </div>
          {viewMode === 'live' && (
            <Button
              onClick={handleSyncAndVerify}
              disabled={isVerifying}
              variant="outline"
              className="gap-2"
            >
              {isVerifying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Sync & Verify
            </Button>
          )}
        </div>

        {/* View Mode Toggle */}
        <div className="flex gap-2 mb-4">
          <Button
            variant="ghost"
            onClick={() => setViewMode('live')}
            className={cn(
              "flex-1 gap-2",
              viewMode === 'live' 
                ? "bg-primary/20 text-primary ring-2 ring-primary ring-offset-2 ring-offset-background"
                : "bg-muted/50 hover:bg-muted"
            )}
          >
            <TrendingUp className="w-4 h-4" />
            Live Results
            <span className="text-xs opacity-70">(14 days)</span>
          </Button>
          <Button
            variant="ghost"
            onClick={() => setViewMode('archive')}
            className={cn(
              "flex-1 gap-2",
              viewMode === 'archive' 
                ? "bg-primary/20 text-primary ring-2 ring-primary ring-offset-2 ring-offset-background"
                : "bg-muted/50 hover:bg-muted"
            )}
          >
            <Archive className="w-4 h-4" />
            Monthly Archive
          </Button>
        </div>

        {viewMode === 'archive' ? (
          /* ARCHIVE VIEW */
          <div className="space-y-6">
            {/* Month Selector */}
            <div className="flex justify-center">
              <MonthSelector 
                selectedMonth={selectedMonth} 
                onMonthChange={setSelectedMonth} 
              />
            </div>

            {/* Archive Stats */}
            {archiveLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : archiveResults && archiveResults.length > 0 ? (
              <>
                <ArchiveStatsCard stats={archiveStats} />

                {/* Archived Results by Date */}
                <div className="space-y-6">
                  {archiveSortedDates.map(date => (
                    <div key={date}>
                      {/* Date Header */}
                      <div className="flex items-center gap-2 mb-3">
                        <CalendarDays className="w-4 h-4 text-muted-foreground" />
                        <h2 className="text-sm font-semibold text-muted-foreground">
                          {formatDateHeader(date)}
                        </h2>
                        <div className="flex-1 h-px bg-border/50" />
                        <span className="text-xs text-muted-foreground">
                          {archiveGroupedByDate[date].filter(p => p.outcome === 'hit').length}W - {' '}
                          {archiveGroupedByDate[date].filter(p => p.outcome === 'miss').length}L
                        </span>
                      </div>

                      {/* Results for this date */}
                      <div className="space-y-2">
                        {archiveGroupedByDate[date].map(result => (
                          <ArchiveResultCard key={result.id} result={result} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <Card className="border-border/50">
                <CardContent className="py-16 text-center">
                  <Archive className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No archived results for {format(selectedMonth, 'MMMM yyyy')}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Results are archived after games are settled
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          /* LIVE VIEW */
          <>
            {/* Engine Filter Tabs */}
            <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
              {[
                { key: 'all' as const, label: 'All Engines', icon: null },
                { key: 'risk' as const, label: 'Risk Engine', icon: Target, color: 'text-blue-400' },
                { key: 'sharp' as const, label: 'Sharp AI', icon: Zap, color: 'text-amber-400' },
                { key: 'heat' as const, label: 'Heat Engine', icon: Flame, color: 'text-orange-400' },
              ].map(engine => (
                <Button
                  key={engine.key}
                  variant="ghost"
                  size="sm"
                  onClick={() => setEngineFilter(engine.key)}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap",
                    engineFilter === engine.key 
                      ? "bg-primary/20 text-primary ring-2 ring-primary ring-offset-2 ring-offset-background"
                      : "bg-muted/50 hover:bg-muted"
                  )}
                >
                  {engine.icon && <engine.icon className={cn("w-4 h-4", engine.color)} />}
                  {engine.label}
                  <span className="opacity-70">
                    ({engine.key === 'all' 
                      ? stats.totalSettled 
                      : stats.byEngine[engine.key].wins + stats.byEngine[engine.key].losses + stats.byEngine[engine.key].pushes})
                  </span>
                </Button>
              ))}
            </div>

            {/* Stats Banner */}
            <Card className="mb-6 bg-gradient-to-br from-primary/10 via-background to-background border-primary/20">
              <CardContent className="py-4">
                <div className="grid grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <Trophy className="w-4 h-4 text-green-400" />
                      <span className="text-2xl font-bold text-green-400">{filteredStats.totalWins}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Wins</span>
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <XCircle className="w-4 h-4 text-red-400" />
                      <span className="text-2xl font-bold text-red-400">{filteredStats.totalLosses}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Losses</span>
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <MinusCircle className="w-4 h-4 text-amber-400" />
                      <span className="text-2xl font-bold text-amber-400">{filteredStats.totalPushes}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Pushes</span>
                  </div>
                  <div>
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <TrendingUp className="w-4 h-4 text-primary" />
                      <span className="text-2xl font-bold text-primary">
                        {filteredStats.winRate.toFixed(1)}%
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">Win Rate</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Live Games Indicator */}
            {livePropsCount > 0 && (
              <div className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <Radio className="w-4 h-4 text-red-400 animate-pulse" />
                <span className="text-sm font-medium text-blue-400">
                  {livePropsCount} prop{livePropsCount !== 1 ? 's' : ''} tracking live
                </span>
                <span className="text-xs text-muted-foreground">
                  • Stats update every 30 seconds
                </span>
              </div>
            )}

            {/* Outcome Filters */}
            <div className="flex flex-wrap gap-2 mb-6">
              {[
                { key: 'all' as const, label: 'All Results', count: filteredStats.totalSettled + stats.totalPending, color: '', icon: null },
                { key: 'hit' as const, label: 'Wins', count: filteredStats.totalWins, color: 'text-green-400', icon: Trophy },
                { key: 'miss' as const, label: 'Losses', count: filteredStats.totalLosses, color: 'text-red-400', icon: XCircle },
                { key: 'push' as const, label: 'Pushes', count: filteredStats.totalPushes, color: 'text-amber-400', icon: MinusCircle },
                { key: 'pending' as const, label: 'In Progress', count: stats.totalPending, color: 'text-blue-400', icon: Clock },
              ].map(filter => (
                <Button
                  key={filter.key}
                  variant="ghost"
                  size="sm"
                  onClick={() => setOutcomeFilter(filter.key)}
                  className={cn(
                    "transition-all gap-1.5",
                    outcomeFilter === filter.key 
                      ? "bg-primary/20 text-primary ring-2 ring-primary ring-offset-2 ring-offset-background"
                      : "bg-muted/50 hover:bg-muted",
                    filter.color
                  )}
                >
                  {filter.icon && <filter.icon className="w-3.5 h-3.5" />}
                  {filter.label}
                  <span className="ml-0.5 opacity-70">({filter.count})</span>
                </Button>
              ))}
            </div>

            {/* Results by Date */}
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : sortedDates.length === 0 ? (
              <Card className="border-border/50">
                <CardContent className="py-16 text-center">
                  <Trophy className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No settled picks yet</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Results will appear here once games are completed
                  </p>
                  <Button 
                    variant="outline" 
                    className="mt-4"
                    onClick={handleSyncAndVerify}
                    disabled={isVerifying}
                  >
                    Check for Results
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {sortedDates.map(date => (
                  <div key={date}>
                    {/* Date Header */}
                    <div className="flex items-center gap-2 mb-3">
                      <CalendarDays className="w-4 h-4 text-muted-foreground" />
                      <h2 className="text-sm font-semibold text-muted-foreground">
                        {formatDateHeader(date)}
                      </h2>
                      <div className="flex-1 h-px bg-border/50" />
                      <span className="text-xs text-muted-foreground">
                        {filteredGrouped[date].filter(p => p.outcome === 'hit').length}W - {' '}
                        {filteredGrouped[date].filter(p => p.outcome === 'miss').length}L
                      </span>
                    </div>

                    {/* Results for this date */}
                    <div className="space-y-2">
                      {filteredGrouped[date].map(result => (
                        result.type === 'parlay' ? (
                          <ParlayResultCard key={result.id} result={result} />
                        ) : (
                          <PropResultCard 
                            key={result.id} 
                            result={result} 
                            liveData={liveDataMap.get(result.id)}
                          />
                        )
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

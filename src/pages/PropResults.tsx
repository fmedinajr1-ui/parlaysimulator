import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Trophy, XCircle, MinusCircle, TrendingUp, Loader2, RefreshCw, CalendarDays } from "lucide-react";
import { usePropResults, PropResult } from "@/hooks/usePropResults";
import { PropResultCard } from "@/components/market/PropResultCard";
import { cn } from "@/lib/utils";
import { format, parseISO, isToday, isYesterday } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

type OutcomeFilter = 'all' | 'hit' | 'miss' | 'push';

function formatDateHeader(dateStr: string): string {
  const date = parseISO(dateStr);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'EEEE, MMMM d, yyyy');
}

export default function PropResults() {
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all');
  const [isVerifying, setIsVerifying] = useState(false);
  const queryClient = useQueryClient();
  const { data: results, isLoading, stats, groupedByDate } = usePropResults(14);

  const handleVerifyOutcomes = async () => {
    setIsVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-risk-engine-outcomes');
      
      if (error) throw error;
      
      if (data.success) {
        toast.success(`Verified ${data.verified} picks: ${data.hits}W - ${data.misses}L - ${data.pushes}P`);
        queryClient.invalidateQueries({ queryKey: ['prop-results'] });
      } else {
        toast.error(data.error || 'Verification failed');
      }
    } catch (error) {
      console.error('Verification error:', error);
      toast.error('Failed to verify outcomes');
    } finally {
      setIsVerifying(false);
    }
  };

  // Filter results by outcome
  const filteredGrouped = Object.entries(groupedByDate).reduce((acc, [date, picks]) => {
    const filtered = outcomeFilter === 'all' 
      ? picks 
      : picks.filter(p => p.outcome === outcomeFilter);
    if (filtered.length > 0) {
      acc[date] = filtered;
    }
    return acc;
  }, {} as Record<string, PropResult[]>);

  const sortedDates = Object.keys(filteredGrouped).sort((a, b) => 
    parseISO(b).getTime() - parseISO(a).getTime()
  );

  return (
    <div className="min-h-screen bg-background pb-24">
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
          <Button
            onClick={handleVerifyOutcomes}
            disabled={isVerifying}
            variant="outline"
            className="gap-2"
          >
            {isVerifying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Verify Outcomes
          </Button>
        </div>

        {/* Stats Banner */}
        <Card className="mb-6 bg-gradient-to-br from-primary/10 via-background to-background border-primary/20">
          <CardContent className="py-4">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="flex items-center justify-center gap-2 mb-1">
                  <Trophy className="w-4 h-4 text-green-400" />
                  <span className="text-2xl font-bold text-green-400">{stats.totalWins}</span>
                </div>
                <span className="text-xs text-muted-foreground">Wins</span>
              </div>
              <div>
                <div className="flex items-center justify-center gap-2 mb-1">
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span className="text-2xl font-bold text-red-400">{stats.totalLosses}</span>
                </div>
                <span className="text-xs text-muted-foreground">Losses</span>
              </div>
              <div>
                <div className="flex items-center justify-center gap-2 mb-1">
                  <MinusCircle className="w-4 h-4 text-amber-400" />
                  <span className="text-2xl font-bold text-amber-400">{stats.totalPushes}</span>
                </div>
                <span className="text-xs text-muted-foreground">Pushes</span>
              </div>
              <div>
                <div className="flex items-center justify-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  <span className="text-2xl font-bold text-primary">
                    {stats.winRate.toFixed(1)}%
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">Win Rate</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Outcome Filters */}
        <div className="flex flex-wrap gap-2 mb-6">
          {[
            { key: 'all' as const, label: 'All Results', count: stats.totalSettled, color: '' },
            { key: 'hit' as const, label: 'Wins', count: stats.totalWins, color: 'text-green-400' },
            { key: 'miss' as const, label: 'Losses', count: stats.totalLosses, color: 'text-red-400' },
            { key: 'push' as const, label: 'Pushes', count: stats.totalPushes, color: 'text-amber-400' },
          ].map(filter => (
            <Button
              key={filter.key}
              variant="ghost"
              size="sm"
              onClick={() => setOutcomeFilter(filter.key)}
              className={cn(
                "transition-all",
                outcomeFilter === filter.key 
                  ? "bg-primary/20 text-primary ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "bg-muted/50 hover:bg-muted",
                filter.color
              )}
            >
              {filter.label}
              <span className="ml-1.5 opacity-70">({filter.count})</span>
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
                onClick={handleVerifyOutcomes}
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
                    <PropResultCard key={result.id} result={result} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

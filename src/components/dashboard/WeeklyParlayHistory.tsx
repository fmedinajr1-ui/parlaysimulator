import { useWeeklyParlayHistory, type ParlayRecord } from "@/hooks/useWeeklyParlayHistory";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Calendar, 
  RefreshCw, 
  Zap, 
  Flame, 
  TrendingUp, 
  TrendingDown,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ParlayBreakdownCard, type ParlayData } from "./ParlayBreakdownCard";

function StatBox({ value, label, className }: { value: number; label: string; className?: string }) {
  return (
    <div className="text-center">
      <div className={cn("text-2xl font-bold", className)}>{value}</div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
    </div>
  );
}

function SystemRow({ 
  icon: Icon, 
  name, 
  stats, 
  iconClassName 
}: { 
  icon: typeof Zap; 
  name: string; 
  stats: { won: number; lost: number; push: number; winRate: number };
  iconClassName: string;
}) {
  const record = `${stats.won}W - ${stats.lost}L${stats.push > 0 ? ` - ${stats.push}P` : ''}`;
  
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", iconClassName)} />
        <span className="font-medium text-sm">{name}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">{record}</span>
        <span className="text-sm font-semibold min-w-[45px] text-right">
          {stats.winRate.toFixed(1)}%
        </span>
        <div className="w-16">
          <Progress 
            value={stats.winRate} 
            className="h-1.5"
          />
        </div>
      </div>
    </div>
  );
}

function convertToParlayData(parlay: ParlayRecord): ParlayData {
  return {
    id: parlay.id,
    date: parlay.date,
    system: parlay.system,
    type: parlay.type,
    outcome: parlay.outcome,
    legs: parlay.legs,
    total_odds: parlay.total_odds,
  };
}

function DailySection({ 
  date, 
  parlays,
  isToday 
}: { 
  date: string;
  parlays: ParlayRecord[];
  isToday: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(isToday);
  
  const wonCount = parlays.filter(p => p.outcome === 'won').length;
  const lostCount = parlays.filter(p => p.outcome === 'lost').length;
  const pendingCount = parlays.filter(p => p.outcome === 'pending').length;
  const settledCount = wonCount + lostCount;
  const winRate = settledCount > 0 ? (wonCount / settledCount) * 100 : null;

  if (parlays.length === 0) {
    return (
      <div className="flex items-center justify-between py-2 text-sm text-muted-foreground border-b border-border/30 last:border-0">
        <span>{isToday ? 'Today' : format(parseISO(date), 'EEE, MMM d')}</span>
        <span className="text-xs">No parlays</span>
      </div>
    );
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded} className="border-b border-border/30 last:border-0">
      <CollapsibleTrigger asChild>
        <div className="flex items-center justify-between py-2 cursor-pointer hover:bg-muted/10 transition-colors rounded-lg px-2 -mx-2">
          <div className="flex items-center gap-2">
            <span className={cn("font-medium text-sm", isToday && "text-primary")}>
              {isToday ? 'Today' : format(parseISO(date), 'EEE, MMM d')}
            </span>
            {pendingCount > 0 && (
              <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                ⏳ {pendingCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {settledCount > 0 && (
              <div className="flex items-center gap-1.5">
                <span className={cn(
                  "text-sm font-semibold",
                  winRate !== null && winRate >= 50 ? "text-green-500" : "text-red-500"
                )}>
                  {wonCount}-{lostCount}
                </span>
                {winRate !== null && (
                  <span className="text-xs text-muted-foreground">
                    ({winRate.toFixed(0)}%)
                  </span>
                )}
              </div>
            )}
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 pb-3 space-y-2">
        {parlays.map((parlay) => (
          <ParlayBreakdownCard 
            key={parlay.id} 
            parlay={convertToParlayData(parlay)}
            defaultOpen={isToday && parlay.outcome === 'lost'}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function WeeklyParlayHistory() {
  const { data, isLoading, refetch, isRefetching } = useWeeklyParlayHistory();
  const [showDaily, setShowDaily] = useState(true);
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['weekly-parlay-history'] });
    refetch();
  };

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-8 w-20" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-5 gap-4">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
          <Skeleton className="h-2 w-full" />
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const { overall, bySystem, dailyRecords, streak } = data;
  const winRateColor = overall.winRate >= 60 ? 'text-green-500' : 
                       overall.winRate >= 40 ? 'text-yellow-500' : 'text-red-500';
  const today = format(new Date(), 'yyyy-MM-dd');

  return (
    <Card className="glass-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">7-Day Performance</CardTitle>
            {streak.count >= 3 && streak.type && (
              <span className={cn(
                "text-xs px-2 py-0.5 rounded-full font-medium",
                streak.type === 'W' 
                  ? "bg-green-500/20 text-green-500" 
                  : "bg-red-500/20 text-red-500"
              )}>
                {streak.count}{streak.type} streak
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRefresh}
            disabled={isRefetching}
            className="h-8 px-2"
          >
            <RefreshCw className={cn("h-4 w-4", isRefetching && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Overall Stats */}
        <div className="grid grid-cols-5 gap-2 sm:gap-4">
          <StatBox value={overall.won} label="Wins" className="text-green-500" />
          <StatBox value={overall.lost} label="Losses" className="text-red-500" />
          <StatBox value={overall.push} label="Pushes" className="text-yellow-500" />
          <StatBox value={overall.pending} label="Pending" className="text-muted-foreground" />
          <div className="text-center">
            <div className={cn("text-2xl font-bold", winRateColor)}>
              {overall.winRate.toFixed(0)}%
            </div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Win Rate</div>
          </div>
        </div>

        {/* Win Rate Progress */}
        <div className="space-y-1">
          <Progress 
            value={overall.winRate} 
            className="h-2"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0%</span>
            <span className="flex items-center gap-1">
              {overall.winRate >= 50 ? (
                <TrendingUp className="h-3 w-3 text-green-500" />
              ) : (
                <TrendingDown className="h-3 w-3 text-red-500" />
              )}
              {overall.won + overall.lost} settled
            </span>
            <span>100%</span>
          </div>
        </div>

        {/* System Breakdown */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-muted-foreground">By System</h4>
          <SystemRow 
            icon={Zap} 
            name="Sharp AI" 
            stats={bySystem.sharp}
            iconClassName="text-neon-yellow"
          />
          <SystemRow 
            icon={Flame} 
            name="Heat Engine" 
            stats={bySystem.heat}
            iconClassName="text-orange-500"
          />
        </div>

        {/* Daily Breakdown with Expandable Parlays */}
        <Collapsible open={showDaily} onOpenChange={setShowDaily}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between h-8 px-2">
              <span className="text-sm font-medium text-muted-foreground">Daily Breakdown</span>
              {showDaily ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1">
            {dailyRecords.map((record) => (
              <DailySection 
                key={record.date} 
                date={record.date}
                parlays={record.parlays}
                isToday={record.date === today}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

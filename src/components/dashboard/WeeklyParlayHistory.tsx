import { useWeeklyParlayHistory } from "@/hooks/useWeeklyParlayHistory";
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

function OutcomeBadge({ outcome }: { outcome: 'won' | 'lost' | 'push' | 'pending' | null }) {
  if (!outcome) return <span className="text-xs text-muted-foreground">-</span>;
  
  const config = {
    won: { icon: '✅', className: 'text-green-500' },
    lost: { icon: '❌', className: 'text-red-500' },
    push: { icon: '➡️', className: 'text-yellow-500' },
    pending: { icon: '⏳', className: 'text-muted-foreground' },
  };
  
  const { icon, className } = config[outcome];
  return <span className={cn("text-xs", className)}>{icon}</span>;
}

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

function DailyRow({ record }: { record: {
  date: string;
  sharpParlays: { safe: 'won' | 'lost' | 'push' | 'pending' | null; balanced: 'won' | 'lost' | 'push' | 'pending' | null; upside: 'won' | 'lost' | 'push' | 'pending' | null };
  heatParlays: { core: 'won' | 'lost' | 'push' | 'pending' | null; upside: 'won' | 'lost' | 'push' | 'pending' | null };
  totals: { won: number; lost: number; push: number; pending: number };
}}) {
  const { date, sharpParlays, heatParlays, totals } = record;
  const isToday = date === format(new Date(), 'yyyy-MM-dd');
  const settled = totals.won + totals.lost;
  const winRate = settled > 0 ? (totals.won / settled) * 100 : null;
  
  const hasParlays = sharpParlays.safe || sharpParlays.balanced || sharpParlays.upside || 
                     heatParlays.core || heatParlays.upside;
  
  if (!hasParlays) {
    return (
      <div className="flex items-center justify-between py-2 text-sm text-muted-foreground">
        <span>{format(parseISO(date), 'MMM d')}</span>
        <span className="text-xs">No parlays</span>
      </div>
    );
  }

  return (
    <div className="py-2 border-b border-border/50 last:border-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className={cn("font-medium text-sm", isToday && "text-primary")}>
            {isToday ? 'Today' : format(parseISO(date), 'MMM d')}
          </span>
          {totals.pending > 0 && (
            <span className="text-xs text-muted-foreground">
              ⏳ {totals.pending} pending
            </span>
          )}
        </div>
        {settled > 0 && (
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "text-sm font-semibold",
              winRate && winRate >= 50 ? "text-green-500" : "text-red-500"
            )}>
              {totals.won}-{totals.lost}
            </span>
            <span className="text-xs text-muted-foreground">
              ({winRate?.toFixed(0)}%)
            </span>
          </div>
        )}
      </div>
      
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5">
          <Zap className="h-3 w-3 text-neon-yellow" />
          <span className="text-muted-foreground">Sharp:</span>
          <div className="flex gap-1">
            <span title="SAFE"><OutcomeBadge outcome={sharpParlays.safe} /></span>
            <span title="BALANCED"><OutcomeBadge outcome={sharpParlays.balanced} /></span>
            <span title="UPSIDE"><OutcomeBadge outcome={sharpParlays.upside} /></span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Flame className="h-3 w-3 text-orange-500" />
          <span className="text-muted-foreground">Heat:</span>
          <div className="flex gap-1">
            <span title="CORE"><OutcomeBadge outcome={heatParlays.core} /></span>
            <span title="UPSIDE"><OutcomeBadge outcome={heatParlays.upside} /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WeeklyParlayHistory() {
  const { data, isLoading, refetch, isRefetching } = useWeeklyParlayHistory();
  const [isExpanded, setIsExpanded] = useState(true);
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

        {/* Daily Breakdown */}
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between h-8 px-2">
              <span className="text-sm font-medium text-muted-foreground">Daily Breakdown</span>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <div className="space-y-0">
              {dailyRecords.map((record) => (
                <DailyRow key={record.date} record={record} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

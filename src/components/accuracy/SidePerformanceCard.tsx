import { useSidePerformanceTracking, SideSummary } from "@/hooks/useSidePerformanceTracking";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";
import { TrendingUp, TrendingDown, Minus, ArrowUp, ArrowDown } from "lucide-react";

function getTrendIcon(trend: 'improving' | 'stable' | 'declining') {
  switch (trend) {
    case 'improving':
      return <TrendingUp className="w-4 h-4 text-green-400" />;
    case 'declining':
      return <TrendingDown className="w-4 h-4 text-red-400" />;
    default:
      return <Minus className="w-4 h-4 text-muted-foreground" />;
  }
}

function getTrendLabel(trend: 'improving' | 'stable' | 'declining') {
  switch (trend) {
    case 'improving':
      return <span className="text-green-400 text-xs">📈 Improving</span>;
    case 'declining':
      return <span className="text-red-400 text-xs">📉 Declining</span>;
    default:
      return <span className="text-muted-foreground text-xs">➡️ Stable</span>;
  }
}

function getHitRateColor(hitRate: number): string {
  if (hitRate >= 55) return 'text-green-400';
  if (hitRate >= 50) return 'text-yellow-400';
  return 'text-red-400';
}

function formatWeekLabel(dateStr: string): string {
  try {
    const date = parseISO(dateStr);
    return format(date, 'MMM d');
  } catch {
    return dateStr;
  }
}

interface SideSummaryCardProps {
  summary: SideSummary | undefined;
  icon: string;
  label: string;
  isLoading: boolean;
}

function SideSummaryCard({ summary, icon, label, isLoading }: SideSummaryCardProps) {
  if (isLoading) {
    return (
      <Card className="p-3 bg-muted/20 flex-1">
        <Skeleton className="h-4 w-20 mb-2" />
        <Skeleton className="h-8 w-16 mb-1" />
        <Skeleton className="h-3 w-24" />
      </Card>
    );
  }

  if (!summary) {
    return (
      <Card className="p-3 bg-muted/20 flex-1">
        <div className="flex items-center gap-1 text-sm font-medium mb-1">
          <span>{icon}</span>
          <span>{label}</span>
        </div>
        <div className="text-muted-foreground text-xs">No data</div>
      </Card>
    );
  }

  return (
    <Card className="p-3 bg-muted/20 flex-1">
      <div className="flex items-center gap-1 text-sm font-medium mb-1">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <div className={cn("text-2xl font-bold", getHitRateColor(summary.overallHitRate))}>
        {summary.overallHitRate}%
      </div>
      <div className="text-xs text-muted-foreground">
        {summary.totalHits}W - {summary.totalMisses}L
      </div>
      <div className="mt-1">
        {getTrendLabel(summary.weeklyTrend)}
      </div>
    </Card>
  );
}

export function SidePerformanceCard() {
  const { weeklyData, overSummary, underSummary, isLoading } = useSidePerformanceTracking(60);

  // Fix deployment date for highlighting (Feb 5, 2025)
  const fixDeploymentDate = new Date('2025-02-05');

  const isPostFix = (dateStr: string) => {
    try {
      return parseISO(dateStr) >= fixDeploymentDate;
    } catch {
      return false;
    }
  };

  return (
    <div className="space-y-4 mt-4">
      {/* Summary Cards */}
      <div className="flex gap-3">
        <SideSummaryCard
          summary={overSummary}
          icon="⬆️"
          label="OVER"
          isLoading={isLoading}
        />
        <SideSummaryCard
          summary={underSummary}
          icon="⬇️"
          label="UNDER"
          isLoading={isLoading}
        />
      </div>

      {/* Weekly Breakdown Table */}
      <div>
        <h4 className="text-sm font-medium mb-2 text-muted-foreground">Weekly Breakdown</h4>
        <div className="rounded-lg border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs h-8 px-2">Week</TableHead>
                <TableHead className="text-xs h-8 px-2 text-center">
                  <span className="flex items-center justify-center gap-1">
                    <ArrowUp className="w-3 h-3" />
                    OVER
                  </span>
                </TableHead>
                <TableHead className="text-xs h-8 px-2 text-center">
                  <span className="flex items-center justify-center gap-1">
                    <ArrowDown className="w-3 h-3" />
                    UNDER
                  </span>
                </TableHead>
                <TableHead className="text-xs h-8 px-2 text-center">Ceiling %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="px-2 py-2"><Skeleton className="h-4 w-14" /></TableCell>
                    <TableCell className="px-2 py-2"><Skeleton className="h-4 w-10 mx-auto" /></TableCell>
                    <TableCell className="px-2 py-2"><Skeleton className="h-4 w-10 mx-auto" /></TableCell>
                    <TableCell className="px-2 py-2"><Skeleton className="h-4 w-10 mx-auto" /></TableCell>
                  </TableRow>
                ))
              ) : weeklyData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-4">
                    No settled picks in this period
                  </TableCell>
                </TableRow>
              ) : (
                weeklyData.slice(0, 6).map((week) => {
                  const postFix = isPostFix(week.weekStart);
                  return (
                    <TableRow 
                      key={week.weekStart}
                      className={cn(postFix && "bg-green-500/5")}
                    >
                      <TableCell className="px-2 py-2 text-xs font-medium">
                        <span className="flex items-center gap-1">
                          {formatWeekLabel(week.weekStart)}
                          {postFix && <span className="text-green-400">✓</span>}
                        </span>
                      </TableCell>
                      <TableCell className="px-2 py-2 text-center">
                        {week.over ? (
                          <span className={cn("text-xs font-medium", getHitRateColor(week.over.hitRate))}>
                            {week.over.hitRate}%
                            <span className="text-muted-foreground ml-1">
                              ({week.over.hits}-{week.over.misses})
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-center">
                        {week.under ? (
                          <span className={cn("text-xs font-medium", getHitRateColor(week.under.hitRate))}>
                            {week.under.hitRate}%
                            {week.under.hitRate >= 70 && <span className="ml-1">🔥</span>}
                            <span className="text-muted-foreground ml-1">
                              ({week.under.hits}-{week.under.misses})
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </TableCell>
                      <TableCell className="px-2 py-2 text-center text-xs">
                        {week.under?.avgCeilingProtection ? (
                          <span className={cn(
                            week.under.avgCeilingProtection >= 70 ? "text-green-400" : "text-yellow-400"
                          )}>
                            {week.under.avgCeilingProtection}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Filter Info */}
      <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg p-3">
        <div className="flex items-center gap-2">
          <span>🎯</span>
          <span>
            <strong>New Filter Active:</strong> 70% Ceiling Protection threshold for UNDERs
          </span>
        </div>
        <div className="mt-1 ml-6">
          Expected improvement: 60% → 70%+ on UNDER picks
        </div>
      </div>
    </div>
  );
}

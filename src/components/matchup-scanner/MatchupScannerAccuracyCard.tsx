import { useState } from 'react';
import { Target, Crosshair, TrendingUp, TrendingDown, BarChart3, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { useMatchupScannerAccuracy } from '@/hooks/useMatchupScannerAccuracy';

const BREAKEVEN = 52.4;

export function MatchupScannerAccuracyCard() {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data, isLoading, error } = useMatchupScannerAccuracy(30);

  if (isLoading) {
    return (
      <Card className="border-border">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-6 w-48" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="p-4 text-center text-muted-foreground text-sm">
          Failed to load accuracy data
        </CardContent>
      </Card>
    );
  }

  if (!data?.hasData) {
    return (
      <Card className="border-border bg-muted/20">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Info size={18} className="text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Accuracy Tracking Active</p>
              <p className="text-xs text-muted-foreground mt-1">
                Matchup Scanner picks are being recorded. Accuracy data will appear once games complete and outcomes are verified (typically 1-2 days).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const totalPicks = data.ptsTotal + data.threesTotal;
  const totalHits = data.ptsHits + data.threesHits;
  const overallHitRate = totalPicks > 0 ? (totalHits / totalPicks) * 100 : 0;
  const isProfitable = overallHitRate >= BREAKEVEN;

  return (
    <Card className="border-border">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="p-4 pb-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 size={18} className="text-primary" />
              <CardTitle className="text-base">Scanner Accuracy</CardTitle>
              <span className="text-xs text-muted-foreground">(30 days)</span>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>

        <CardContent className="p-4 pt-3">
          {/* Summary Row */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            {/* Points */}
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <div className="flex items-center gap-1.5 mb-1">
                <Target size={14} className="text-amber-400" />
                <span className="text-xs font-medium text-amber-300">POINTS</span>
              </div>
              <div className="text-lg font-bold text-foreground">
                {data.ptsHits}W - {data.ptsMisses}L
              </div>
              <div className={cn(
                "text-sm font-medium",
                data.ptsHitRate >= BREAKEVEN ? "text-green-400" : "text-red-400"
              )}>
                {data.ptsHitRate.toFixed(1)}% Hit Rate
              </div>
            </div>

            {/* 3-Pointers */}
            <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
              <div className="flex items-center gap-1.5 mb-1">
                <Crosshair size={14} className="text-cyan-400" />
                <span className="text-xs font-medium text-cyan-300">3-POINTERS</span>
              </div>
              <div className="text-lg font-bold text-foreground">
                {data.threesHits}W - {data.threesMisses}L
              </div>
              <div className={cn(
                "text-sm font-medium",
                data.threesHitRate >= BREAKEVEN ? "text-green-400" : "text-red-400"
              )}>
                {data.threesHitRate.toFixed(1)}% Hit Rate
              </div>
            </div>
          </div>

          {/* Overall */}
          <div className={cn(
            "text-center p-2 rounded-md text-sm font-medium",
            isProfitable ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
          )}>
            Combined: {totalHits}W - {totalPicks - totalHits}L ({overallHitRate.toFixed(1)}%)
            {isProfitable ? " ✓ Profitable" : ` (Need ${BREAKEVEN}%)`}
          </div>

          {/* Expanded Content */}
          <CollapsibleContent>
            <div className="mt-4 space-y-4">
              {/* By Grade */}
              {data.byGrade.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    By Grade
                  </h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-8 text-xs">Grade</TableHead>
                        <TableHead className="h-8 text-xs text-right">Picks</TableHead>
                        <TableHead className="h-8 text-xs text-right">Hits</TableHead>
                        <TableHead className="h-8 text-xs text-right">Hit Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byGrade.map((row) => (
                        <TableRow key={row.grade}>
                          <TableCell className="py-2 font-medium">
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-xs",
                              row.grade === 'A+' && "bg-amber-500/20 text-amber-400",
                              row.grade === 'A' && "bg-green-500/20 text-green-400",
                              row.grade === 'B+' && "bg-teal-500/20 text-teal-400",
                              row.grade === 'B' && "bg-muted text-muted-foreground"
                            )}>
                              {row.grade}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 text-right tabular-nums">{row.total}</TableCell>
                          <TableCell className="py-2 text-right tabular-nums">{row.hits}</TableCell>
                          <TableCell className={cn(
                            "py-2 text-right tabular-nums font-medium",
                            row.hitRate >= BREAKEVEN ? "text-green-400" : "text-red-400"
                          )}>
                            {row.hitRate.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* By Side */}
              {data.bySide.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    By Side
                  </h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="h-8 text-xs">Side</TableHead>
                        <TableHead className="h-8 text-xs text-right">Picks</TableHead>
                        <TableHead className="h-8 text-xs text-right">Hits</TableHead>
                        <TableHead className="h-8 text-xs text-right">Hit Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.bySide.map((row) => (
                        <TableRow key={row.side}>
                          <TableCell className="py-2 font-medium">
                            <span className={cn(
                              "flex items-center gap-1",
                              row.side === 'OVER' ? "text-green-400" : "text-red-400"
                            )}>
                              {row.side === 'OVER' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                              {row.side}
                            </span>
                          </TableCell>
                          <TableCell className="py-2 text-right tabular-nums">{row.total}</TableCell>
                          <TableCell className="py-2 text-right tabular-nums">{row.hits}</TableCell>
                          <TableCell className={cn(
                            "py-2 text-right tabular-nums font-medium",
                            row.hitRate >= BREAKEVEN ? "text-green-400" : "text-red-400"
                          )}>
                            {row.hitRate.toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Insight */}
              {data.byGrade.length >= 2 && (
                <div className="p-3 bg-muted/50 rounded-md">
                  <p className="text-xs text-muted-foreground">
                    💡 <span className="font-medium text-foreground">Calibration Check:</span>{' '}
                    {data.byGrade[0]?.hitRate > data.byGrade[data.byGrade.length - 1]?.hitRate ? (
                      <>
                        {data.byGrade[0]?.grade} picks hit at {data.byGrade[0]?.hitRate.toFixed(0)}% vs {data.byGrade[data.byGrade.length - 1]?.grade} at {data.byGrade[data.byGrade.length - 1]?.hitRate.toFixed(0)}% — edge score is well-calibrated.
                      </>
                    ) : (
                      <>
                        Grade correlation needs more data. Currently {data.byGrade[0]?.grade} at {data.byGrade[0]?.hitRate.toFixed(0)}%.
                      </>
                    )}
                  </p>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  );
}

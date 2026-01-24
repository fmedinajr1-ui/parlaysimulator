import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, XCircle, Filter, ArrowUpDown, Activity } from "lucide-react";
import { DecisionTraceRow, SCORE_WEIGHTS } from "@/hooks/useSweetSpotParlayBuilder";

interface Props {
  traces: DecisionTraceRow[];
  activePreset: string;
}

export function DecisionTraceDashboard({ traces, activePreset }: Props) {
  const [filter, setFilter] = useState<'all' | 'selected' | 'blocked'>('all');
  const [sortBy, setSortBy] = useState<'score' | 'l10' | 'conf'>('score');

  const filteredTraces = traces
    .filter(t => {
      if (filter === 'selected') return t.selected;
      if (filter === 'blocked') return !t.selected;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'score') return b.scoreTotal - a.scoreTotal;
      if (sortBy === 'l10') return (b.l10 ?? 0) - (a.l10 ?? 0);
      if (sortBy === 'conf') return (b.conf ?? 0) - (a.conf ?? 0);
      return 0;
    });

  const selectedCount = traces.filter(t => t.selected).length;
  const blockedCount = traces.filter(t => !t.selected).length;

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Decision Trace
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {activePreset.toUpperCase()} preset
          </Badge>
        </div>
        
        {/* Weight summary */}
        <div className="flex gap-2 text-xs text-muted-foreground mt-1">
          <span>Pat×{SCORE_WEIGHTS.pattern}</span>
          <span>|</span>
          <span>L10×{SCORE_WEIGHTS.l10}</span>
          <span>|</span>
          <span>Conf×{SCORE_WEIGHTS.confidence}</span>
          <span>|</span>
          <span>Penalty: {SCORE_WEIGHTS.missingL10Penalty}</span>
        </div>
        
        {/* Controls */}
        <div className="flex gap-2 mt-3">
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({traces.length})</SelectItem>
              <SelectItem value="selected">Selected ({selectedCount})</SelectItem>
              <SelectItem value="blocked">Blocked ({blockedCount})</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <ArrowUpDown className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="score">By Score</SelectItem>
              <SelectItem value="l10">By L10</SelectItem>
              <SelectItem value="conf">By Conf</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      
      <CardContent className="pt-0">
        {traces.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No decision traces available. Build a parlay to see selection logic.
          </div>
        ) : (
          <div className="max-h-[400px] overflow-auto rounded border border-border/30">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="text-xs">Player</TableHead>
                  <TableHead className="text-xs">Cat</TableHead>
                  <TableHead className="text-xs text-right">Pat</TableHead>
                  <TableHead className="text-xs text-right">L10</TableHead>
                  <TableHead className="text-xs text-right">Conf</TableHead>
                  <TableHead className="text-xs text-right">Pen</TableHead>
                  <TableHead className="text-xs text-right font-bold">Total</TableHead>
                  <TableHead className="text-xs text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTraces.map((t, i) => (
                  <TableRow 
                    key={`${t.player}-${t.category}-${i}`} 
                    className={t.selected ? 'bg-green-500/5' : ''}
                  >
                    <TableCell className="font-medium text-xs py-2">
                      <div>{t.player}</div>
                      {t.team && (
                        <span className="text-[10px] text-muted-foreground">{t.team}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant="outline" 
                        className="text-[9px] px-1.5 py-0"
                      >
                        {t.category?.replace(/_/g, ' ') || 'N/A'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs font-mono">
                      {t.scorePattern.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <div className="flex flex-col items-end">
                        <span className={t.l10 == null ? 'text-amber-400' : ''}>
                          {t.l10 != null ? `${(t.l10 * 100).toFixed(0)}%` : 'MISS'}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          ({t.scoreL10.toFixed(2)})
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      <div className="flex flex-col items-end">
                        <span>{((t.conf ?? 0) * 100).toFixed(0)}%</span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          ({t.scoreConf.toFixed(2)})
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className={`text-right text-xs font-mono ${t.scorePenalty < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {t.scorePenalty.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right text-xs font-bold font-mono">
                      {t.scoreTotal.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-center">
                      {t.selected ? (
                        <CheckCircle2 className="h-4 w-4 text-primary mx-auto" />
                      ) : (
                        <div className="flex flex-col items-center gap-0.5">
                          <XCircle className="h-4 w-4 text-destructive" />
                          {t.blockedReason && (
                            <span className="text-[9px] text-muted-foreground max-w-[80px] truncate">
                              {t.blockedReason}
                            </span>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

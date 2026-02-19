import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { PropEdge } from '@/types/scout-agent';
import { PropHedgeIndicator } from './PropHedgeIndicator';
import { PlayerL5History } from './PlayerL5History';
import { Copy, ChevronDown, ChevronUp, TrendingUp, TrendingDown, AlertTriangle, Timer, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface EdgeRowCompactProps {
  edge: PropEdge;
  rank?: number;
}

// Risk flag config for display
const RISK_FLAG_CONFIG: Record<string, { label: string; severity: 'low' | 'medium' | 'high' }> = {
  'FOUL_TROUBLE': { label: 'Foul Trouble', severity: 'high' },
  'BLOWOUT_RISK': { label: 'Blowout Risk', severity: 'high' },
  'HIGH_FATIGUE': { label: 'High Fatigue', severity: 'medium' },
  'MINUTES_VOLATILITY': { label: 'Minutes Volatile', severity: 'medium' },
  'INJURY_WATCH': { label: 'Injury Watch', severity: 'high' },
  'CLOSE_GAME_BOOST': { label: 'Close Game', severity: 'low' },
  'foul_trouble': { label: 'Foul Trouble', severity: 'high' },
};

export function EdgeRowCompact({ edge, rank }: EdgeRowCompactProps) {
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);

  const edgeValue = (edge.expectedFinal ?? 0) - (edge.line ?? 0);
  const confPct = edge.calibratedProb != null 
    ? Math.round(edge.calibratedProb * 100) 
    : edge.confidence;
  const lowRange = edge.uncertainty != null ? edge.expectedFinal - edge.uncertainty : null;
  const highRange = edge.uncertainty != null ? edge.expectedFinal + edge.uncertainty : null;
  
  // Calculate progress toward line
  const progress = edge.line > 0 
    ? Math.min(100, ((edge.currentStat ?? 0) / edge.line) * 100)
    : 0;

  const handleCopy = () => {
    const betText = `${edge.player} ${edge.prop} ${edge.lean} ${edge.line}`;
    navigator.clipboard.writeText(betText);
    toast({
      title: "Copied to clipboard",
      description: betText,
    });
  };

  const leanColor = edge.lean === 'OVER' 
    ? 'bg-chart-2 text-chart-2-foreground' 
    : 'bg-chart-4 text-chart-4-foreground';

  const confColor = confPct >= 80 
    ? 'text-chart-2' 
    : confPct >= 70 
    ? 'text-chart-3' 
    : 'text-foreground';

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <Card className={cn(
        "border-border/50 transition-all hover:border-primary/30",
        confPct >= 80 && "border-chart-2/30 bg-chart-2/5"
      )}>
        <CardContent className="p-3">
          {/* Main Row */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              {/* Player + Prop + Lean */}
              <div className="flex items-center gap-2 flex-wrap">
                {rank && (
                  <span className="text-xs text-muted-foreground font-mono">#{rank}</span>
                )}
                <span className="font-semibold truncate">{edge.player}</span>
                <Badge className={cn("text-xs font-bold", leanColor)}>
                  {edge.lean} {edge.prop} {edge.line}
                </Badge>
                {edge.rotationRole && (
                  <Badge variant="outline" className="text-[10px] px-1.5">
                    {edge.rotationRole}
                  </Badge>
                )}
              </div>

              {/* Current | Proj | Edge | Conf */}
              <div className="flex items-center gap-3 mt-1 text-sm flex-wrap">
              {/* Current stat - prominently displayed with context */}
                {edge.currentStat !== undefined && (
                  <span className="text-muted-foreground">
                    Now <span className="font-bold text-lg text-foreground">{edge.currentStat}</span>
                    {edge.minutesPlayed === 0 && (
                      <span className="text-xs text-muted-foreground/70 ml-1">(not played)</span>
                    )}
                    {edge.minutesPlayed !== undefined && edge.minutesPlayed > 0 && edge.currentStat === 0 && (
                      <span className="text-xs text-chart-3 ml-1">(verifying...)</span>
                    )}
                  </span>
                )}
                <span className="text-muted-foreground">
                  Proj <span className={cn("font-medium", confColor)}>{edge.expectedFinal.toFixed(1)}</span>
                </span>
                <span className="text-muted-foreground">
                  Edge{' '}
                  <span className={cn(
                    "font-medium",
                    edgeValue >= 0 ? "text-chart-2" : "text-chart-4"
                  )}>
                    {edgeValue >= 0 ? '+' : ''}{edgeValue.toFixed(1)}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Conf <span className={cn("font-medium", confColor)}>{confPct}%</span>
                </span>
              </div>

              {/* Visual Progress Bar */}
              {edge.currentStat !== undefined && edge.line > 0 && (
                <div className="mt-2">
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={cn(
                        "h-full rounded-full transition-all duration-300",
                        progress >= 100 ? "bg-chart-2" : 
                        progress >= 75 ? "bg-chart-3" : "bg-primary"
                      )}
                      style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                    <span>{Math.round(progress)}% to line</span>
                    <span>Line: {edge.line}</span>
                  </div>
                </div>
              )}

              {/* Hedge Indicator */}
              <PropHedgeIndicator edge={edge} />

              {/* L5 History */}
              <PlayerL5History playerName={edge.player} propType={edge.prop} line={edge.line} lean={edge.lean} />

              {/* Range Band */}
              {lowRange != null && highRange != null && (
                <div className="text-xs text-muted-foreground mt-1">
                  Range: <span className="font-mono">{lowRange.toFixed(1)} – {highRange.toFixed(1)}</span>
                  {edge.uncertainty && (
                    <span className="ml-1">(±{edge.uncertainty.toFixed(1)})</span>
                  )}
                </div>
              )}

              {/* Top 2 Drivers */}
              {edge.drivers && edge.drivers.length > 0 && (
                <div className="text-xs text-muted-foreground mt-1">
                  {edge.drivers.slice(0, 2).join(' · ')}
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="default"
                className="h-8 px-3 gap-1.5"
                onClick={handleCopy}
              >
                <Copy className="w-3.5 h-3.5" />
                Copy
              </Button>
              <CollapsibleTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 gap-1.5"
                >
                  {isExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  Details
                </Button>
              </CollapsibleTrigger>
            </div>
          </div>

          {/* Expanded Details */}
          <CollapsibleContent>
            <div className="mt-3 pt-3 border-t space-y-3">
              {/* Minutes & Rate Info */}
              <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                {edge.minutesPlayed !== undefined && (
                  <div className="flex items-center gap-1">
                    <Timer className="w-3 h-3" />
                    <span>{edge.minutesPlayed.toFixed(1)} min played</span>
                  </div>
                )}
                {edge.remainingMinutes !== undefined && (
                  <div className="flex items-center gap-1">
                    <Target className="w-3 h-3" />
                    <span>~{edge.remainingMinutes.toFixed(1)} min left</span>
                    {edge.minutesUncertainty && (
                      <span className="text-muted-foreground/70">±{edge.minutesUncertainty.toFixed(1)}</span>
                    )}
                  </div>
                )}
              </div>

              {/* All Drivers */}
              {edge.drivers && edge.drivers.length > 2 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">All Drivers</p>
                  <div className="space-y-0.5">
                    {edge.drivers.map((driver, idx) => (
                      <p key={idx} className="text-xs text-muted-foreground">• {driver}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Risk Flags */}
              {edge.riskFlags && edge.riskFlags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {edge.riskFlags.map((flag, idx) => {
                    const config = RISK_FLAG_CONFIG[flag] || { label: flag.replace(/_/g, ' '), severity: 'medium' };
                    const severityClass = {
                      low: 'bg-chart-2/10 text-chart-2 border-chart-2/30',
                      medium: 'bg-chart-3/10 text-chart-3 border-chart-3/30',
                      high: 'bg-destructive/10 text-destructive border-destructive/30',
                    }[config.severity];

                    return (
                      <Badge 
                        key={idx} 
                        variant="outline" 
                        className={cn("text-[10px] px-1.5 py-0.5", severityClass)}
                      >
                        {config.severity === 'high' && <AlertTriangle className="w-2.5 h-2.5 mr-1" />}
                        {config.label}
                      </Badge>
                    );
                  })}
                </div>
              )}

              {/* Trend Indicator */}
              {edge.trend && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Trend:</span>
                  {edge.trend === 'strengthening' && (
                    <span className="flex items-center gap-1 text-chart-2">
                      <TrendingUp className="w-3 h-3" /> Strengthening
                    </span>
                  )}
                  {edge.trend === 'weakening' && (
                    <span className="flex items-center gap-1 text-destructive">
                      <TrendingDown className="w-3 h-3" /> Weakening
                    </span>
                  )}
                  {edge.trend === 'stable' && (
                    <span className="text-muted-foreground">Stable</span>
                  )}
                </div>
              )}

              {/* Bookmaker Prices */}
              {(edge.overPrice || edge.underPrice) && (
                <div className="flex items-center justify-between text-xs pt-2 border-t">
                  <span className={cn(
                    "font-mono",
                    edge.lean === 'OVER' ? "text-chart-2 font-semibold" : "text-muted-foreground"
                  )}>
                    O {edge.overPrice && edge.overPrice > 0 ? '+' : ''}{edge.overPrice || '-'}
                  </span>
                  {edge.bookmaker && (
                    <Badge variant="outline" className="text-[10px] px-1.5">
                      {edge.bookmaker}
                    </Badge>
                  )}
                  <span className={cn(
                    "font-mono",
                    edge.lean === 'UNDER' ? "text-chart-4 font-semibold" : "text-muted-foreground"
                  )}>
                    U {edge.underPrice && edge.underPrice > 0 ? '+' : ''}{edge.underPrice || '-'}
                  </span>
                </div>
              )}

              {/* Game Time */}
              {edge.gameTime && (
                <div className="text-xs text-muted-foreground font-mono text-right">
                  Captured: {edge.gameTime}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
}

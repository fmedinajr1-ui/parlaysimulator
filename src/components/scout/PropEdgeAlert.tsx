import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PropEdge } from '@/types/scout-agent';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Zap, Timer, Target, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PropEdgeAlertProps {
  edge: PropEdge;
  showDetails?: boolean;
}

// Risk flag display config
const RISK_FLAG_CONFIG: Record<string, { label: string; severity: 'low' | 'medium' | 'high' }> = {
  'FOUL_TROUBLE': { label: 'Foul Trouble', severity: 'high' },
  'BLOWOUT_RISK': { label: 'Blowout Risk', severity: 'high' },
  'HIGH_FATIGUE': { label: 'High Fatigue', severity: 'medium' },
  'MINUTES_VOLATILITY': { label: 'Minutes Volatile', severity: 'medium' },
  'INJURY_WATCH': { label: 'Injury Watch', severity: 'high' },
  'CLOSE_GAME_BOOST': { label: 'Close Game', severity: 'low' },
  'foul_trouble': { label: 'Foul Trouble', severity: 'high' },
};

export function PropEdgeAlert({ edge, showDetails = true }: PropEdgeAlertProps) {
  const trendIcon = {
    strengthening: <TrendingUp className="w-4 h-4 text-chart-2" />,
    weakening: <TrendingDown className="w-4 h-4 text-destructive" />,
    stable: <Minus className="w-4 h-4 text-muted-foreground" />,
  };

  const confidenceColor = edge.confidence >= 80 
    ? 'bg-chart-2 text-chart-2-foreground'
    : edge.confidence >= 70 
    ? 'bg-chart-3 text-chart-3-foreground' 
    : edge.confidence >= 60
    ? 'bg-primary text-primary-foreground'
    : 'bg-muted text-muted-foreground';

  const leanColor = edge.lean === 'OVER' 
    ? 'text-chart-2 border-chart-2/50 bg-chart-2/10'
    : 'text-chart-4 border-chart-4/50 bg-chart-4/10';

  // Calculate edge margin display
  const edgeMargin = edge.edgeMargin ?? (edge.expectedFinal ? Math.abs(edge.expectedFinal - edge.line) : null);
  const hasProjection = edge.expectedFinal && edge.expectedFinal > 0;

  return (
    <Card className={cn(
      "border-border/50 transition-all hover:border-primary/50",
      edge.confidence >= 80 && edge.trend === 'strengthening' && "border-chart-2/50 bg-chart-2/5"
    )}>
      <CardContent className="p-3 space-y-2">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{edge.player}</span>
            <Badge variant="outline" className={cn("text-xs font-bold", leanColor)}>
              {edge.lean} {edge.prop}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {trendIcon[edge.trend]}
            <Badge className={cn("text-xs", confidenceColor)}>
              {edge.confidence}%
            </Badge>
          </div>
        </div>

        {/* Projection vs Line - NEW PROMINENT DISPLAY */}
        {hasProjection && (
          <div className="flex items-center justify-between p-2 rounded bg-accent/50">
            <div className="flex items-center gap-3">
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Current</div>
                <div className="font-mono font-bold text-lg">{edge.currentStat ?? '—'}</div>
              </div>
              <Target className="w-4 h-4 text-muted-foreground" />
              <div className="text-center">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Projected</div>
                <div className={cn(
                  "font-mono font-bold text-lg",
                  edge.lean === 'OVER' ? 'text-chart-2' : 'text-chart-4'
                )}>
                  {edge.expectedFinal.toFixed(1)}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">vs Line</div>
              <div className="font-mono font-medium">
                {edge.line}
                {edgeMargin !== null && (
                  <span className={cn(
                    "ml-1 text-xs",
                    edge.lean === 'OVER' ? 'text-chart-2' : 'text-chart-4'
                  )}>
                    ({edge.lean === 'OVER' ? '+' : '-'}{edgeMargin.toFixed(1)})
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Simple Line Info for non-projection edges */}
        {!hasProjection && (
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Line:</span>
              <span className="font-mono font-medium">{edge.line}</span>
              {edge.actualLine && edge.actualLine !== edge.line && (
                <span className="text-xs text-muted-foreground">
                  (Book: {edge.actualLine})
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground font-mono">{edge.gameTime}</span>
          </div>
        )}

        {/* Minutes & Rate Info */}
        {(edge.remainingMinutes || edge.minutesPlayed) && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            {edge.minutesPlayed !== undefined && (
              <div className="flex items-center gap-1">
                <Timer className="w-3 h-3" />
                <span>{edge.minutesPlayed.toFixed(1)} min played</span>
              </div>
            )}
            {edge.remainingMinutes !== undefined && (
              <div className="flex items-center gap-1">
                <Activity className="w-3 h-3" />
                <span>~{edge.remainingMinutes.toFixed(1)} min left</span>
              </div>
            )}
          </div>
        )}

        {showDetails && (
          <>
            {/* Drivers */}
            <div className="space-y-1">
              {edge.drivers.slice(0, 3).map((driver, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Zap className="w-3 h-3 text-primary" />
                  <span>{driver}</span>
                </div>
              ))}
            </div>

            {/* Risk Flags - Enhanced Display */}
            {edge.riskFlags.length > 0 && (
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

            {/* Bookmaker Prices */}
            {edge.overPrice && edge.underPrice && (
              <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
                <span className="text-muted-foreground">
                  O {edge.overPrice > 0 ? '+' : ''}{edge.overPrice}
                </span>
                <span className="text-xs text-muted-foreground font-mono">{edge.gameTime}</span>
                <span className="text-muted-foreground">
                  U {edge.underPrice > 0 ? '+' : ''}{edge.underPrice}
                </span>
              </div>
            )}

            {/* Game time if no bookmaker prices */}
            {(!edge.overPrice || !edge.underPrice) && hasProjection && (
              <div className="text-xs text-muted-foreground text-right pt-1 border-t border-border/50 font-mono">
                {edge.gameTime}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface PropEdgeListProps {
  edges: PropEdge[];
  maxDisplay?: number;
}

export function PropEdgeList({ edges, maxDisplay = 5 }: PropEdgeListProps) {
  const sortedEdges = [...edges]
    .filter(e => e.confidence >= 65)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxDisplay);

  if (sortedEdges.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        <Zap className="w-8 h-8 mx-auto mb-2 opacity-50" />
        <p>No prop edges detected yet</p>
        <p className="text-xs">Keep monitoring for signals</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sortedEdges.map((edge, idx) => (
        <PropEdgeAlert key={`${edge.player}-${edge.prop}-${idx}`} edge={edge} />
      ))}
    </div>
  );
}

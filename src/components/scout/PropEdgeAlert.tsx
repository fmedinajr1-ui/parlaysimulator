import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PropEdge } from '@/types/scout-agent';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PropEdgeAlertProps {
  edge: PropEdge;
  showDetails?: boolean;
}

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
    : 'bg-muted text-muted-foreground';

  const leanColor = edge.lean === 'OVER' 
    ? 'text-chart-2 border-chart-2/50 bg-chart-2/10'
    : 'text-chart-4 border-chart-4/50 bg-chart-4/10';

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

        {/* Line Info */}
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

            {/* Risk Flags */}
            {edge.riskFlags.length > 0 && (
              <div className="flex items-center gap-2 p-2 bg-chart-4/10 rounded text-xs">
                <AlertTriangle className="w-3 h-3 text-chart-4" />
                <span className="text-chart-4">
                  {edge.riskFlags.map(f => f.replace('_', ' ')).join(', ')}
                </span>
              </div>
            )}

            {/* Bookmaker Prices */}
            {edge.overPrice && edge.underPrice && (
              <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
                <span className="text-muted-foreground">
                  O {edge.overPrice > 0 ? '+' : ''}{edge.overPrice}
                </span>
                <span className="text-muted-foreground">
                  U {edge.underPrice > 0 ? '+' : ''}{edge.underPrice}
                </span>
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

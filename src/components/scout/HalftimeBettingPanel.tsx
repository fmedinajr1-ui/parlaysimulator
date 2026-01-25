import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PropEdge, HalftimeLockedProp } from '@/types/scout-agent';
import { EdgeFilters, PropKind } from './EdgeFilters';
import { EdgeRowCompact } from './EdgeRowCompact';
import { Lock, Target, Zap, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface HalftimeBettingPanelProps {
  edges: PropEdge[];
  mode: 'LIVE' | 'HALFTIME_LOCK';
  lockedRecommendations: HalftimeLockedProp[];
  gameTime: string;
  lockTime?: string;
}

// Composite ranking algorithm for "bet usefulness"
function rankEdge(e: PropEdge): number {
  const edge = Math.abs((e.expectedFinal ?? 0) - (e.line ?? 0));
  const conf = e.calibratedProb != null ? e.calibratedProb * 100 : e.confidence;
  const unc = e.uncertainty ?? 0;
  const volPenalty = e.rotationVolatilityFlag ? 12 : 0;
  
  // Higher is better: confidence + edge bonus - uncertainty penalty - volatility penalty
  return conf + (edge * 8) - (unc * 6) - volPenalty;
}

export function HalftimeBettingPanel({
  edges,
  mode,
  lockedRecommendations,
  gameTime,
  lockTime,
}: HalftimeBettingPanelProps) {
  const { toast } = useToast();
  
  // Filter state
  const [propFilter, setPropFilter] = useState<PropKind | 'ALL'>('PRA');
  const [hideVolatile, setHideVolatile] = useState(true);
  const [startersOnly, setStartersOnly] = useState(false);
  const [minConfidence, setMinConfidence] = useState(65);

  // Convert locked recommendations to PropEdge format for display
  const lockedEdges: PropEdge[] = useMemo(() => {
    return lockedRecommendations.map(rec => ({
      player: rec.player,
      prop: rec.prop as PropEdge['prop'],
      line: rec.line,
      lean: rec.lean,
      confidence: rec.confidence,
      expectedFinal: rec.expectedFinal ?? rec.line + (rec.lean === 'OVER' ? 2 : -2),
      drivers: rec.drivers,
      riskFlags: [],
      trend: 'stable' as const,
      gameTime: lockTime || '',
      overPrice: rec.overPrice,
      underPrice: rec.underPrice,
      bookmaker: rec.bookmaker,
      currentStat: rec.firstHalfStats?.points,
      rotationRole: undefined,
    }));
  }, [lockedRecommendations, lockTime]);

  // Filter and rank active edges
  const rankedEdges = useMemo(() => {
    const getConfidence = (e: PropEdge) => 
      e.calibratedProb != null ? Math.round(e.calibratedProb * 100) : e.confidence;

    return [...(edges || [])]
      .filter(e => propFilter === 'ALL' || e.prop === propFilter)
      .filter(e => getConfidence(e) >= minConfidence)
      .filter(e => !hideVolatile || !e.rotationVolatilityFlag)
      .filter(e => {
        if (!startersOnly) return true;
        const role = e.rotationRole?.toUpperCase();
        return role === 'STARTER' || role === 'CLOSER';
      })
      .sort((a, b) => rankEdge(b) - rankEdge(a))
      .slice(0, 8);
  }, [edges, propFilter, hideVolatile, startersOnly, minConfidence]);

  const handleCopyAll = () => {
    const bets = (mode === 'HALFTIME_LOCK' ? lockedEdges : rankedEdges)
      .map(e => `${e.player} ${e.prop} ${e.lean} ${e.line}`)
      .join('\n');
    navigator.clipboard.writeText(bets);
    toast({
      title: "All bets copied",
      description: `${rankedEdges.length} bets copied to clipboard`,
    });
  };

  return (
    <Card className="border-primary/30 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Target className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Halftime Betting Console</CardTitle>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Status Badge */}
            <Badge 
              variant="outline" 
              className={cn(
                "gap-1.5",
                mode === 'HALFTIME_LOCK' 
                  ? "bg-chart-2/10 text-chart-2 border-chart-2/30" 
                  : "bg-primary/10 text-primary border-primary/30"
              )}
            >
              {mode === 'HALFTIME_LOCK' ? (
                <>
                  <Lock className="w-3 h-3" />
                  LOCKED
                </>
              ) : (
                <>
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  LIVE
                </>
              )}
            </Badge>
            
            {/* Game Time */}
            {gameTime && (
              <Badge variant="secondary" className="font-mono text-xs">
                {gameTime}
              </Badge>
            )}

            {/* Copy All Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyAll}
              className="gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy All
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Locked Recommendations Section */}
        {mode === 'HALFTIME_LOCK' && lockedEdges.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-2 bg-chart-2/10 rounded-lg border border-chart-2/30">
              <Lock className="w-4 h-4 text-chart-2" />
              <div className="flex-1">
                <p className="font-medium text-sm">Halftime Bets Ready</p>
                <p className="text-xs text-muted-foreground">
                  Locked at {lockTime} • {lockedEdges.length} recommendations
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {lockedEdges.map((edge, idx) => (
                <EdgeRowCompact key={`locked-${edge.player}-${edge.prop}-${idx}`} edge={edge} rank={idx + 1} />
              ))}
            </div>

            {edges.length > 0 && (
              <div className="pt-3 border-t">
                <p className="text-xs text-muted-foreground mb-2">Live Tracking (Q3/Q4)</p>
              </div>
            )}
          </div>
        )}

        {/* Filters (for live mode or showing remaining edges after lock) */}
        {(mode === 'LIVE' || edges.length > 0) && (
          <EdgeFilters
            propFilter={propFilter}
            onPropFilterChange={setPropFilter}
            hideVolatile={hideVolatile}
            onHideVolatileChange={setHideVolatile}
            startersOnly={startersOnly}
            onStartersOnlyChange={setStartersOnly}
            minConfidence={minConfidence}
            onMinConfidenceChange={setMinConfidence}
          />
        )}

        {/* Ranked Edges List */}
        {rankedEdges.length > 0 ? (
          <div className="space-y-2">
            {rankedEdges.map((edge, idx) => (
              <EdgeRowCompact 
                key={`${edge.player}-${edge.prop}-${idx}`} 
                edge={edge} 
                rank={mode === 'HALFTIME_LOCK' ? undefined : idx + 1}
              />
            ))}
          </div>
        ) : (
          mode === 'LIVE' && (
            <div className="text-center py-8 text-muted-foreground">
              <Zap className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="font-medium">No edges match your filters</p>
              <p className="text-sm">
                Try lowering min confidence or allowing volatile picks
              </p>
            </div>
          )
        )}

        {/* Pre-lock empty state */}
        {mode === 'LIVE' && edges.length === 0 && lockedRecommendations.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Target className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="font-medium">Analyzing Game...</p>
            <p className="text-sm">
              Prop edges will appear as the agent processes data
            </p>
            {gameTime && (
              <p className="text-xs mt-2 font-mono">Current: {gameTime}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

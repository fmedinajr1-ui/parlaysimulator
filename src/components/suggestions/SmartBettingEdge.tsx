import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { 
  BarChart3, ArrowUpRight, ArrowDownRight, Zap, 
  Clock, ChevronDown, ChevronUp, Flame, Snowflake,
  TrendingUp, TrendingDown, Target
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface LineEdge {
  id: string;
  description: string;
  sport: string;
  bookLine: number;
  medianLine: number;
  edgeAmount: number;
  edgeType: 'over' | 'under' | 'ml';
  confidence: number;
  historicalHitRate: number;
  recommendation: string;
  homeTeam: string;
  awayTeam: string;
  homeAvg?: number;
  awayAvg?: number;
  homeLast5?: number[];
  awayLast5?: number[];
  homeStreak?: { type: 'over' | 'under'; count: number };
  awayStreak?: { type: 'over' | 'under'; count: number };
  gameTime?: string;
  sharpAligned?: boolean;
}

interface SmartBettingEdgeProps {
  compact?: boolean;
}

export const SmartBettingEdge = ({ compact = false }: SmartBettingEdgeProps) => {
  const [expandedEdge, setExpandedEdge] = useState<string | null>(null);

  const { data: edges, isLoading } = useQuery({
    queryKey: ['smart-betting-edges-enhanced'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('calculate-line-value', {
        body: { sport: 'NBA' }
      });

      if (error) {
        console.error('Error fetching line values:', error);
        return [];
      }

      return data?.edges || [];
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Fetch sharp money to check alignment
  const { data: sharpMoves } = useQuery({
    queryKey: ['sharp-money-alignment'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('line_movements')
        .select('*')
        .eq('is_sharp_action', true)
        .gte('detected_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('price_change', { ascending: false })
        .limit(20);

      if (error) throw error;
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fetch moneyline value from line movements
  const { data: mlEdges } = useQuery({
    queryKey: ['ml-value-edges-enhanced'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('line_movements')
        .select('*')
        .eq('is_sharp_action', true)
        .gte('detected_at', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
        .order('price_change', { ascending: false })
        .limit(5);

      if (error) throw error;

      return data?.map(m => ({
        id: m.id,
        description: m.description,
        sport: m.sport,
        priceChange: m.price_change,
        recommendation: m.recommendation,
        confidence: m.authenticity_confidence || 0.5,
        sharpIndicator: m.sharp_indicator,
        detected_at: m.detected_at,
      })) || [];
    },
    staleTime: 3 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasEdges = (edges && edges.length > 0) || (mlEdges && mlEdges.length > 0);

  if (!hasEdges) {
    return (
      <Card className="bg-card/50 backdrop-blur border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4 text-primary" />
            Smart Betting Edge
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <BarChart3 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No betting edges detected</p>
            <p className="text-xs text-muted-foreground mt-1">Check back closer to game time</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Check if sharp money aligns with an edge
  const checkSharpAlignment = (edge: LineEdge): boolean => {
    if (!sharpMoves) return false;
    return sharpMoves.some(m => {
      const matchesGame = m.description?.toLowerCase().includes(edge.homeTeam?.toLowerCase() || '') ||
                         m.description?.toLowerCase().includes(edge.awayTeam?.toLowerCase() || '');
      const matchesDirection = (edge.edgeType === 'over' && m.recommendation === 'PICK') ||
                              (edge.edgeType === 'under' && m.recommendation === 'FADE');
      return matchesGame && matchesDirection;
    });
  };

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4 text-primary" />
          Smart Betting Edge
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Line Value Edges - Enhanced */}
        {edges && edges.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Target className="h-3 w-3" />
              Line Value Analysis
            </p>
            {edges.slice(0, compact ? 2 : 4).map((edge: LineEdge) => {
              const sharpAligned = checkSharpAlignment(edge);
              
              return (
                <Collapsible
                  key={edge.id}
                  open={expandedEdge === edge.id}
                  onOpenChange={(open) => setExpandedEdge(open ? edge.id : null)}
                >
                  <div 
                    className={cn(
                      "rounded-lg border transition-all",
                      edge.edgeType === 'over' && "bg-green-500/5 border-green-500/30",
                      edge.edgeType === 'under' && "bg-blue-500/5 border-blue-500/30",
                      edge.edgeType === 'ml' && "bg-purple-500/5 border-purple-500/30",
                      sharpAligned && "ring-1 ring-yellow-500/50"
                    )}
                  >
                    <CollapsibleTrigger className="w-full p-3 text-left">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          {/* Game Matchup Header */}
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-sm font-medium">{edge.description}</span>
                            {edge.gameTime && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                <Clock className="h-3 w-3 mr-1" />
                                {edge.gameTime}
                              </Badge>
                            )}
                          </div>
                          
                          {/* Line Comparison */}
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-muted-foreground">
                              Book: <span className="text-foreground font-medium">{edge.bookLine}</span>
                            </span>
                            <span className="text-muted-foreground">|</span>
                            <span className="text-muted-foreground">
                              Calc: <span className="text-foreground font-medium">{edge.medianLine}</span>
                            </span>
                          </div>

                          {/* Confidence Bar */}
                          <div className="mt-2">
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
                              <span>Confidence</span>
                              <span>{Math.round(edge.confidence * 100)}%</span>
                            </div>
                            <Progress 
                              value={edge.confidence * 100} 
                              className="h-1.5"
                            />
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1.5 ml-3">
                          {/* Edge Badge */}
                          <Badge 
                            className={cn(
                              "text-xs",
                              edge.edgeType === 'over' && "bg-green-500/20 text-green-500 border-green-500/30",
                              edge.edgeType === 'under' && "bg-blue-500/20 text-blue-500 border-blue-500/30",
                              edge.edgeType === 'ml' && "bg-purple-500/20 text-purple-500 border-purple-500/30"
                            )}
                          >
                            {edge.edgeType === 'over' ? (
                              <ArrowUpRight className="h-3 w-3 mr-1" />
                            ) : edge.edgeType === 'under' ? (
                              <ArrowDownRight className="h-3 w-3 mr-1" />
                            ) : (
                              <Zap className="h-3 w-3 mr-1" />
                            )}
                            +{edge.edgeAmount} pts
                          </Badge>

                          {/* Sharp Alignment */}
                          {sharpAligned && (
                            <Badge variant="outline" className="text-[10px] bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
                              <Zap className="h-3 w-3 mr-1" />
                              Sharp Aligned
                            </Badge>
                          )}

                          {/* Hit Rate */}
                          <span className={cn(
                            "text-[10px]",
                            edge.historicalHitRate >= 60 ? "text-green-500" : "text-muted-foreground"
                          )}>
                            {Math.round(edge.historicalHitRate)}% hit rate
                          </span>

                          {expandedEdge === edge.id ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="px-3 pb-3 pt-2 border-t border-border/50 space-y-3">
                        {/* Team Breakdown */}
                        <div className="grid grid-cols-2 gap-3">
                          {/* Home Team */}
                          <div className="p-2 rounded bg-muted/30">
                            <div className="flex items-center gap-1 mb-1">
                              <span className="text-[10px] text-muted-foreground">HOME</span>
                              {edge.homeStreak?.type === 'over' && (
                                <Flame className="h-3 w-3 text-orange-500" />
                              )}
                              {edge.homeStreak?.type === 'under' && (
                                <Snowflake className="h-3 w-3 text-blue-500" />
                              )}
                            </div>
                            <p className="text-xs font-medium truncate">{edge.homeTeam}</p>
                            {edge.homeAvg && (
                              <p className="text-[10px] text-muted-foreground">
                                Avg: {Math.round(edge.homeAvg)} pts
                              </p>
                            )}
                            {edge.homeLast5 && (
                              <div className="flex gap-0.5 mt-1">
                                {edge.homeLast5.map((score, i) => (
                                  <div 
                                    key={i}
                                    className={cn(
                                      "w-4 h-3 rounded text-[7px] font-medium flex items-center justify-center",
                                      score > 110 
                                        ? "bg-green-500/20 text-green-600" 
                                        : "bg-blue-500/20 text-blue-600"
                                    )}
                                  >
                                    {Math.round(score / 10)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Away Team */}
                          <div className="p-2 rounded bg-muted/30">
                            <div className="flex items-center gap-1 mb-1">
                              <span className="text-[10px] text-muted-foreground">AWAY</span>
                              {edge.awayStreak?.type === 'over' && (
                                <Flame className="h-3 w-3 text-orange-500" />
                              )}
                              {edge.awayStreak?.type === 'under' && (
                                <Snowflake className="h-3 w-3 text-blue-500" />
                              )}
                            </div>
                            <p className="text-xs font-medium truncate">{edge.awayTeam}</p>
                            {edge.awayAvg && (
                              <p className="text-[10px] text-muted-foreground">
                                Avg: {Math.round(edge.awayAvg)} pts
                              </p>
                            )}
                            {edge.awayLast5 && (
                              <div className="flex gap-0.5 mt-1">
                                {edge.awayLast5.map((score, i) => (
                                  <div 
                                    key={i}
                                    className={cn(
                                      "w-4 h-3 rounded text-[7px] font-medium flex items-center justify-center",
                                      score > 110 
                                        ? "bg-green-500/20 text-green-600" 
                                        : "bg-blue-500/20 text-blue-600"
                                    )}
                                  >
                                    {Math.round(score / 10)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Recommendation Box */}
                        <div className={cn(
                          "p-2 rounded border",
                          edge.edgeType === 'over' 
                            ? "bg-green-500/10 border-green-500/20" 
                            : "bg-blue-500/10 border-blue-500/20"
                        )}>
                          <div className="flex items-center gap-1.5 mb-1">
                            {edge.edgeType === 'over' ? (
                              <TrendingUp className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                              <TrendingDown className="h-3.5 w-3.5 text-blue-500" />
                            )}
                            <span className="text-xs font-medium">
                              {edge.recommendation} {edge.edgeType.toUpperCase()} {edge.bookLine}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            Combined avg of {edge.medianLine} is {edge.edgeAmount} pts {edge.edgeType === 'over' ? 'above' : 'below'} the book line. 
                            Historical {edge.edgeType}s in this range hit {Math.round(edge.historicalHitRate)}% of the time.
                          </p>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        )}

        {/* Sharp Money Edges */}
        {mlEdges && mlEdges.length > 0 && !compact && (
          <div className="space-y-2 pt-2 border-t border-border/50">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Zap className="h-3 w-3" />
              Sharp Money Signals
            </p>
            {mlEdges.slice(0, 3).map((edge) => (
              <div 
                key={edge.id}
                className="p-2.5 rounded-lg bg-muted/30 border border-border/50"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{edge.description}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{edge.sharpIndicator}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge 
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          edge.priceChange > 0 ? "text-green-500 border-green-500/30" : "text-red-500 border-red-500/30"
                        )}
                      >
                        {edge.priceChange > 0 ? '+' : ''}{edge.priceChange} pts
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        {Math.round(edge.confidence * 100)}% confidence
                      </span>
                    </div>
                  </div>
                  <Badge 
                    className={cn(
                      "text-[10px] shrink-0",
                      edge.recommendation === 'PICK' && "bg-green-500/20 text-green-500",
                      edge.recommendation === 'FADE' && "bg-red-500/20 text-red-500"
                    )}
                  >
                    {edge.recommendation}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-3 pt-2 border-t border-border/50">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span>OVER edge</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span>UNDER edge</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Zap className="h-3 w-3 text-yellow-500" />
            <span>Sharp aligned</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { TrendingUp, TrendingDown, Target, Zap, BarChart3, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';

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
}

interface SmartBettingEdgeProps {
  compact?: boolean;
}

export const SmartBettingEdge = ({ compact = false }: SmartBettingEdgeProps) => {
  const { data: edges, isLoading } = useQuery({
    queryKey: ['smart-betting-edges'],
    queryFn: async () => {
      // Fetch today's calculated line values
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

  // Fetch moneyline value from line movements
  const { data: mlEdges } = useQuery({
    queryKey: ['ml-value-edges'],
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
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasEdges = (edges && edges.length > 0) || (mlEdges && mlEdges.length > 0);

  if (!hasEdges) return null;

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4 text-primary" />
          Smart Betting Edge
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Line Value Edges */}
        {edges && edges.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Line Value Analysis</p>
            {edges.slice(0, compact ? 2 : 4).map((edge: LineEdge) => (
              <div 
                key={edge.id}
                className={cn(
                  "p-3 rounded-lg border flex items-center justify-between",
                  edge.edgeType === 'over' && "bg-green-500/5 border-green-500/30",
                  edge.edgeType === 'under' && "bg-blue-500/5 border-blue-500/30",
                  edge.edgeType === 'ml' && "bg-purple-500/5 border-purple-500/30"
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{edge.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">
                      Book: {edge.bookLine} | Median: {edge.medianLine}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge 
                    variant="outline"
                    className={cn(
                      "text-xs",
                      edge.edgeType === 'over' && "text-green-500 border-green-500/50",
                      edge.edgeType === 'under' && "text-blue-500 border-blue-500/50",
                      edge.edgeType === 'ml' && "text-purple-500 border-purple-500/50"
                    )}
                  >
                    {edge.edgeType === 'over' ? (
                      <><ArrowUpRight className="h-3 w-3 mr-1" />OVER Value</>
                    ) : edge.edgeType === 'under' ? (
                      <><ArrowDownRight className="h-3 w-3 mr-1" />UNDER Value</>
                    ) : (
                      <><Zap className="h-3 w-3 mr-1" />ML Edge</>
                    )}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {Math.round(edge.historicalHitRate)}% hit rate
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sharp Money Edges */}
        {mlEdges && mlEdges.length > 0 && !compact && (
          <div className="space-y-2 pt-2 border-t border-border/50">
            <p className="text-xs text-muted-foreground">Sharp Money Signals</p>
            {mlEdges.slice(0, 3).map((edge) => (
              <div 
                key={edge.id}
                className="p-2 rounded-lg bg-muted/30 border border-border/50 flex items-center justify-between"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{edge.description}</p>
                  <p className="text-[10px] text-muted-foreground">{edge.sharpIndicator}</p>
                </div>
                <Badge 
                  variant="secondary"
                  className={cn(
                    "text-[10px]",
                    edge.recommendation === 'PICK' && "bg-green-500/20 text-green-500",
                    edge.recommendation === 'FADE' && "bg-red-500/20 text-red-500"
                  )}
                >
                  {edge.recommendation}
                </Badge>
              </div>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span>OVER when avg &gt; line</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span>UNDER when avg &lt; line</span>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <div className="w-2 h-2 rounded-full bg-purple-500" />
            <span>ML Edge (+EV)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

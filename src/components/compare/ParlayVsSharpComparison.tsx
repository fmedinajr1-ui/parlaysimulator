import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { UniversalLeg } from '@/types/universal-parlay';
import { Check, X, Minus, Zap, AlertTriangle, TrendingUp, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SharpComparison {
  legId: string;
  description: string;
  yourPick: {
    odds: number;
    direction: string;
  };
  sharpData: {
    recommendation: string | null;
    confidence: number;
    priceChange: number;
    sharpIndicator: string | null;
    detected: boolean;
  };
  alignment: 'with' | 'against' | 'no-data';
}

interface ParlayVsSharpComparisonProps {
  legs: UniversalLeg[];
  onClose?: () => void;
}

export const ParlayVsSharpComparison = ({ legs, onClose }: ParlayVsSharpComparisonProps) => {
  const { data: comparisons, isLoading } = useQuery({
    queryKey: ['parlay-vs-sharp', legs.map(l => l.id).join('-')],
    queryFn: async () => {
      // Fetch recent sharp movements
      const { data: sharpMoves, error } = await supabase
        .from('line_movements')
        .select('*')
        .gte('detected_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
        .order('detected_at', { ascending: false });

      if (error) throw error;

      // Match each leg to sharp data
      const results: SharpComparison[] = legs.map(leg => {
        const descLower = leg.description.toLowerCase();
        
        // Find matching sharp movement
        const matchingSharp = sharpMoves?.find(m => {
          const moveDescLower = m.description.toLowerCase();
          // Match by player name, team, or event
          const words = descLower.split(/\s+/).filter(w => w.length > 3);
          return words.some(word => moveDescLower.includes(word));
        });

        // Determine alignment
        let alignment: 'with' | 'against' | 'no-data' = 'no-data';
        
        if (matchingSharp?.recommendation) {
          // Check if user's pick aligns with sharp recommendation
          const isOver = descLower.includes('over') || leg.side === 'over';
          const isUnder = descLower.includes('under') || leg.side === 'under';
          const sharpRec = matchingSharp.recommendation;
          
          if (sharpRec === 'PICK') {
            // Sharp says pick this side
            alignment = 'with';
          } else if (sharpRec === 'FADE') {
            alignment = 'against';
          } else {
            // Check price movement direction
            if (matchingSharp.price_change > 0 && (isOver || descLower.includes('+'))) {
              alignment = 'with';
            } else if (matchingSharp.price_change < 0 && (isUnder || descLower.includes('-'))) {
              alignment = 'with';
            } else if (Math.abs(matchingSharp.price_change) > 5) {
              alignment = 'against';
            }
          }
        }

        return {
          legId: leg.id,
          description: leg.description,
          yourPick: {
            odds: leg.odds,
            direction: leg.side || (descLower.includes('over') ? 'over' : descLower.includes('under') ? 'under' : 'pick'),
          },
          sharpData: {
            recommendation: matchingSharp?.recommendation || null,
            confidence: matchingSharp?.authenticity_confidence || 0,
            priceChange: matchingSharp?.price_change || 0,
            sharpIndicator: matchingSharp?.sharp_indicator || null,
            detected: !!matchingSharp,
          },
          alignment,
        };
      });

      return results;
    },
    enabled: legs.length > 0,
  });

  // Calculate overall alignment score
  const alignmentScore = React.useMemo(() => {
    if (!comparisons) return { aligned: 0, against: 0, noData: 0, percentage: 0 };
    
    const aligned = comparisons.filter(c => c.alignment === 'with').length;
    const against = comparisons.filter(c => c.alignment === 'against').length;
    const noData = comparisons.filter(c => c.alignment === 'no-data').length;
    const withData = aligned + against;
    const percentage = withData > 0 ? Math.round((aligned / withData) * 100) : 50;
    
    return { aligned, against, noData, percentage };
  }, [comparisons]);

  if (isLoading) {
    return (
      <Card className="bg-card/95 backdrop-blur">
        <CardHeader>
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!comparisons || comparisons.length === 0) {
    return (
      <Card className="bg-card/95 backdrop-blur">
        <CardContent className="py-8 text-center">
          <Zap className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No legs to compare</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/95 backdrop-blur border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Your Picks vs Sharp Money
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Alignment Score Summary */}
        <div className={cn(
          "p-4 rounded-xl border",
          alignmentScore.percentage >= 70 && "bg-green-500/10 border-green-500/30",
          alignmentScore.percentage >= 40 && alignmentScore.percentage < 70 && "bg-yellow-500/10 border-yellow-500/30",
          alignmentScore.percentage < 40 && "bg-red-500/10 border-red-500/30"
        )}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-lg font-bold">
                {alignmentScore.aligned} of {alignmentScore.aligned + alignmentScore.against} picks
              </p>
              <p className="text-sm text-muted-foreground">
                aligned with sharp money
              </p>
            </div>
            <div className={cn(
              "text-3xl font-bold",
              alignmentScore.percentage >= 70 && "text-green-500",
              alignmentScore.percentage >= 40 && alignmentScore.percentage < 70 && "text-yellow-500",
              alignmentScore.percentage < 40 && "text-red-500"
            )}>
              {alignmentScore.percentage}%
            </div>
          </div>
          
          <Progress 
            value={alignmentScore.percentage} 
            className="h-2"
          />
          
          <div className="flex items-center justify-center gap-2 mt-3">
            {alignmentScore.percentage >= 70 ? (
              <>
                <Check className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium text-green-500">
                  You're betting WITH the pros! 💪
                </span>
              </>
            ) : alignmentScore.percentage >= 40 ? (
              <>
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                <span className="text-sm font-medium text-yellow-500">
                  Mixed alignment - proceed with caution
                </span>
              </>
            ) : (
              <>
                <X className="h-4 w-4 text-red-500" />
                <span className="text-sm font-medium text-red-500">
                  ⚠️ Contrarian picks detected - reconsider?
                </span>
              </>
            )}
          </div>
        </div>

        {/* Breakdown Stats */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/30">
            <p className="text-lg font-bold text-green-500">{alignmentScore.aligned}</p>
            <p className="text-[10px] text-muted-foreground">With Sharps</p>
          </div>
          <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30">
            <p className="text-lg font-bold text-red-500">{alignmentScore.against}</p>
            <p className="text-[10px] text-muted-foreground">Against Sharps</p>
          </div>
          <div className="p-2 rounded-lg bg-muted/50 border border-border/50">
            <p className="text-lg font-bold text-muted-foreground">{alignmentScore.noData}</p>
            <p className="text-[10px] text-muted-foreground">No Data</p>
          </div>
        </div>

        {/* Individual Leg Comparisons */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Leg-by-Leg Breakdown
          </p>
          
          {comparisons.map((comparison) => (
            <div 
              key={comparison.legId}
              className={cn(
                "p-3 rounded-lg border",
                comparison.alignment === 'with' && "bg-green-500/5 border-green-500/30",
                comparison.alignment === 'against' && "bg-red-500/5 border-red-500/30",
                comparison.alignment === 'no-data' && "bg-muted/30 border-border/50"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                {/* Your Pick */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{comparison.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-[10px]">
                      {comparison.yourPick.odds > 0 ? '+' : ''}{comparison.yourPick.odds}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground uppercase">
                      {comparison.yourPick.direction}
                    </span>
                  </div>
                </div>

                {/* Sharp Data */}
                <div className="flex flex-col items-end gap-1">
                  {comparison.sharpData.detected ? (
                    <>
                      <Badge 
                        className={cn(
                          "text-[10px]",
                          comparison.alignment === 'with' && "bg-green-500 text-white",
                          comparison.alignment === 'against' && "bg-red-500 text-white"
                        )}
                      >
                        {comparison.alignment === 'with' ? (
                          <><Check className="h-3 w-3 mr-1" />WITH SHARPS</>
                        ) : (
                          <><X className="h-3 w-3 mr-1" />AGAINST SHARPS</>
                        )}
                      </Badge>
                      {comparison.sharpData.sharpIndicator && (
                        <span className="text-[10px] text-muted-foreground">
                          {comparison.sharpData.sharpIndicator}
                        </span>
                      )}
                      {comparison.sharpData.priceChange !== 0 && (
                        <span className={cn(
                          "text-[10px]",
                          comparison.sharpData.priceChange > 0 ? "text-green-500" : "text-red-500"
                        )}>
                          {comparison.sharpData.priceChange > 0 ? '+' : ''}{comparison.sharpData.priceChange} pts
                        </span>
                      )}
                    </>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      <Minus className="h-3 w-3 mr-1" />NO DATA
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Pro Tips */}
        <div className="p-3 rounded-lg bg-primary/5 border border-primary/20">
          <p className="text-xs font-medium text-primary mb-1">💡 Pro Tips</p>
          <ul className="text-[10px] text-muted-foreground space-y-1">
            <li>• Picks aligned with sharp money historically hit at higher rates</li>
            <li>• Consider swapping legs that go against heavy sharp action</li>
            <li>• "No Data" legs are neutral - evaluate on other factors</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flame, TrendingUp, DollarSign, Target, Zap } from "lucide-react";
import { LegAnalysis, ParlayLeg } from "@/types/parlay";

interface DoubleDownCardProps {
  legs: ParlayLeg[];
  legAnalyses?: LegAnalysis[];
  stake: number;
  delay?: number;
}

interface HighConfidenceLeg {
  index: number;
  description: string;
  confidence: number;
  reasons: string[];
}

export function DoubleDownCard({ legs, legAnalyses, stake, delay = 0 }: DoubleDownCardProps) {
  if (!legAnalyses) return null;

  // Calculate overall parlay confidence and find high-confidence legs
  const calculateLegConfidence = (legAnalysis: LegAnalysis): number => {
    let score = 50; // Base score
    
    // Confidence level
    if (legAnalysis.confidenceLevel === 'high') score += 20;
    else if (legAnalysis.confidenceLevel === 'medium') score += 10;
    
    // Trend direction
    if (legAnalysis.trendDirection === 'favorable') score += 15;
    else if (legAnalysis.trendDirection === 'unfavorable') score -= 10;
    
    // Sharp recommendation
    if (legAnalysis.sharpRecommendation === 'pick') score += 15;
    else if (legAnalysis.sharpRecommendation === 'fade') score -= 15;
    
    // Usage projection verdict
    if (legAnalysis.usageProjection) {
      if (legAnalysis.usageProjection.verdict === 'FAVORABLE') score += 15;
      else if (legAnalysis.usageProjection.verdict === 'UNFAVORABLE') score -= 10;
      
      // High hit rate bonus
      if (legAnalysis.usageProjection.hitRate.percentage >= 70) score += 10;
    }
    
    // Adjusted probability vs implied
    const impliedProb = 1 / (legAnalysis.vegasJuice || 1);
    if (legAnalysis.adjustedProbability > impliedProb + 0.1) score += 10;
    
    return Math.max(0, Math.min(100, score));
  };

  // Find high confidence legs
  const highConfidenceLegs: HighConfidenceLeg[] = [];
  
  legAnalyses.forEach((la, idx) => {
    const confidence = calculateLegConfidence(la);
    
    if (confidence >= 70) {
      const reasons: string[] = [];
      
      if (la.confidenceLevel === 'high') reasons.push('High AI confidence');
      if (la.trendDirection === 'favorable') reasons.push('Favorable trend');
      if (la.sharpRecommendation === 'pick') reasons.push('Sharp money backing');
      if (la.usageProjection?.verdict === 'FAVORABLE') reasons.push('Favorable usage projection');
      if (la.usageProjection?.hitRate.percentage && la.usageProjection.hitRate.percentage >= 70) {
        reasons.push(`${la.usageProjection.hitRate.percentage}% hit rate`);
      }
      
      highConfidenceLegs.push({
        index: idx,
        description: legs[idx]?.description || `Leg ${idx + 1}`,
        confidence,
        reasons
      });
    }
  });

  // Calculate overall confidence
  const overallConfidence = Math.round(
    legAnalyses.reduce((sum, la) => sum + calculateLegConfidence(la), 0) / legAnalyses.length
  );

  // Only show if overall confidence is high OR we have high-confidence individual legs
  if (overallConfidence < 70 && highConfidenceLegs.length === 0) {
    return null;
  }

  // Suggested stake multiplier
  const stakeMultiplier = overallConfidence >= 80 ? 2 : 1.5;
  const suggestedStake = Math.round(stake * stakeMultiplier * 100) / 100;

  return (
    <Card 
      className="border-2 border-yellow-500/50 bg-gradient-to-br from-yellow-500/10 via-orange-500/5 to-red-500/10 slide-up overflow-hidden"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Animated glow effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-yellow-500/0 via-yellow-500/10 to-yellow-500/0 animate-pulse" />
      
      <CardHeader className="pb-2 relative">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-yellow-400">
            <Flame className="h-5 w-5 animate-pulse" />
            🔥 DOUBLE DOWN OPPORTUNITY
          </CardTitle>
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/50">
            {overallConfidence}% Confidence
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4 relative">
        {/* Main message */}
        <div className="flex items-center gap-3 p-3 bg-background/50 rounded-lg border border-yellow-500/20">
          <div className="p-2 rounded-full bg-yellow-500/20">
            <Target className="h-5 w-5 text-yellow-400" />
          </div>
          <div>
            <p className="font-medium text-foreground">High Confidence Detected</p>
            <p className="text-xs text-muted-foreground">
              Multiple signals align in your favor
            </p>
          </div>
        </div>

        {/* High confidence legs */}
        {highConfidenceLegs.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase">
              Strong Legs ({highConfidenceLegs.length})
            </p>
            {highConfidenceLegs.map((leg, idx) => (
              <div 
                key={idx}
                className="p-2 bg-green-500/10 border border-green-500/20 rounded-lg"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-foreground truncate flex-1 mr-2">
                    {leg.description}
                  </span>
                  <Badge variant="outline" className="text-green-400 border-green-500/50 text-xs">
                    {leg.confidence}%
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-1">
                  {leg.reasons.slice(0, 3).map((reason, ridx) => (
                    <span 
                      key={ridx}
                      className="text-[10px] px-1.5 py-0.5 bg-green-500/10 text-green-400 rounded"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Stake suggestion */}
        <div className="flex items-center justify-between p-3 bg-primary/10 rounded-lg border border-primary/20">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Suggested Stake</span>
          </div>
          <div className="text-right">
            <p className="font-bold text-primary">
              ${stake.toFixed(2)} → ${suggestedStake.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">
              {stakeMultiplier}x increase
            </p>
          </div>
        </div>

        {/* Supporting signals */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          {legAnalyses.some(la => la.sharpRecommendation === 'pick') && (
            <div className="flex items-center gap-1.5 text-blue-400">
              <Zap className="h-3 w-3" />
              Sharp money aligned
            </div>
          )}
          {legAnalyses.some(la => la.usageProjection?.verdict === 'FAVORABLE') && (
            <div className="flex items-center gap-1.5 text-green-400">
              <TrendingUp className="h-3 w-3" />
              Usage favorable
            </div>
          )}
          {legAnalyses.filter(la => la.confidenceLevel === 'high').length >= 2 && (
            <div className="flex items-center gap-1.5 text-purple-400">
              <Target className="h-3 w-3" />
              Multiple high confidence
            </div>
          )}
          {legAnalyses.filter(la => la.trendDirection === 'favorable').length >= Math.ceil(legAnalyses.length / 2) && (
            <div className="flex items-center gap-1.5 text-yellow-400">
              <Flame className="h-3 w-3" />
              Favorable trends
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <p className="text-[10px] text-muted-foreground/70 text-center italic">
          Always bet responsibly. Past performance doesn't guarantee future results.
        </p>
      </CardContent>
    </Card>
  );
}

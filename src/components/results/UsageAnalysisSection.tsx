import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Activity, TrendingUp, AlertTriangle, CheckCircle } from "lucide-react";
import { UsageProjectionCard } from "./UsageProjectionCard";
import { LegAnalysis } from "@/types/parlay";
import { ParlayLeg } from "@/types/parlay";

interface UsageAnalysisSectionProps {
  legs: ParlayLeg[];
  legAnalyses?: LegAnalysis[];
  isLoading?: boolean;
  delay?: number;
}

export function UsageAnalysisSection({ legs, legAnalyses, isLoading, delay = 0 }: UsageAnalysisSectionProps) {
  // Get legs that have usage projections
  const legsWithUsage = legAnalyses?.filter(la => la.usageProjection) || [];
  
  if (legsWithUsage.length === 0 && !isLoading) {
    return null;
  }

  // Calculate overall usage confidence
  const calculateUsageConfidence = () => {
    if (legsWithUsage.length === 0) return 0;
    
    const scores = legsWithUsage.map(la => {
      const proj = la.usageProjection!;
      let score = 50; // Base score
      
      // Hit rate contribution (40% weight)
      if (proj.hitRate.percentage >= 70) score += 20;
      else if (proj.hitRate.percentage >= 60) score += 12;
      else if (proj.hitRate.percentage >= 50) score += 5;
      else if (proj.hitRate.percentage < 40) score -= 10;
      
      // Efficiency margin (30% weight)
      if (proj.efficiencyMargin >= 10) score += 15;
      else if (proj.efficiencyMargin >= 5) score += 10;
      else if (proj.efficiencyMargin >= 0) score += 5;
      else if (proj.efficiencyMargin < -10) score -= 10;
      
      // Verdict boost (20% weight)
      if (proj.verdict === 'FAVORABLE') score += 10;
      else if (proj.verdict === 'UNFAVORABLE') score -= 10;
      
      // Pace/fatigue adjustments (10% weight)
      if (proj.paceImpact > 0) score += 3;
      if (proj.fatigueImpact > 0) score += 3;
      if (proj.fatigueImpact < -5) score -= 5;
      
      return Math.max(0, Math.min(100, score));
    });
    
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  };

  const overallConfidence = calculateUsageConfidence();
  const favorableCount = legsWithUsage.filter(la => la.usageProjection?.verdict === 'FAVORABLE').length;
  const unfavorableCount = legsWithUsage.filter(la => la.usageProjection?.verdict === 'UNFAVORABLE').length;
  
  const getConfidenceLabel = (score: number) => {
    if (score >= 75) return { label: 'ELITE', color: 'text-green-400' };
    if (score >= 60) return { label: 'HIGH', color: 'text-green-400' };
    if (score >= 45) return { label: 'MEDIUM', color: 'text-yellow-400' };
    return { label: 'LOW', color: 'text-red-400' };
  };
  
  const confidenceConfig = getConfidenceLabel(overallConfidence);

  return (
    <div 
      className="space-y-3 slide-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Summary Card */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              📊 USAGE ANALYSIS
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {legsWithUsage.length} prop{legsWithUsage.length !== 1 ? 's' : ''} analyzed
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Confidence Meter */}
          <div className="flex items-center gap-4">
            {/* Circular Gauge */}
            <div className="relative w-20 h-20 flex-shrink-0">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-muted/30"
                  stroke="currentColor"
                  strokeWidth="3"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className={overallConfidence >= 60 ? 'text-green-500' : overallConfidence >= 40 ? 'text-yellow-500' : 'text-red-500'}
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={`${overallConfidence}, 100`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-lg font-bold ${confidenceConfig.color}`}>{overallConfidence}%</span>
              </div>
            </div>
            
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className={`font-bold ${confidenceConfig.color}`}>{confidenceConfig.label}</span>
                <span className="text-xs text-muted-foreground">Overall Confidence</span>
              </div>
              <div className="flex gap-3 text-xs">
                {favorableCount > 0 && (
                  <span className="flex items-center gap-1 text-green-400">
                    <CheckCircle className="h-3 w-3" />
                    {favorableCount} Favorable
                  </span>
                )}
                {unfavorableCount > 0 && (
                  <span className="flex items-center gap-1 text-red-400">
                    <AlertTriangle className="h-3 w-3" />
                    {unfavorableCount} Unfavorable
                  </span>
                )}
                {legsWithUsage.length - favorableCount - unfavorableCount > 0 && (
                  <span className="text-yellow-400">
                    {legsWithUsage.length - favorableCount - unfavorableCount} Neutral
                  </span>
                )}
              </div>
              <Progress value={overallConfidence} className="h-1.5 mt-2" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Individual Usage Cards */}
      {legsWithUsage.map((legAnalysis, idx) => {
        // Find the original leg index by matching in the legAnalyses array
        const originalIdx = legAnalyses?.findIndex(la => la === legAnalysis) ?? idx;
        const leg = legs[originalIdx];
        
        if (!legAnalysis.usageProjection || !leg) return null;
        
        return (
          <UsageProjectionCard
            key={idx}
            projection={legAnalysis.usageProjection}
            legDescription={leg.description}
          />
        );
      })}
      
      {/* No data fallback */}
      {legsWithUsage.length === 0 && !isLoading && legAnalyses?.some(la => la.betType === 'player_prop') && (
        <Card className="border-muted/30">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <AlertTriangle className="h-4 w-4" />
              <span>Usage data unavailable - no historical games found for player props</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

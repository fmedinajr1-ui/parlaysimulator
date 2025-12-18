import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Clock, Target, TrendingUp, TrendingDown, Zap, Shield, Activity, CheckCircle, XCircle, Minus } from "lucide-react";

interface UsageProjection {
  playerName: string;
  propType: string;
  line: number;
  projectedMinutes: { min: number; max: number; avg: number };
  requiredRate: number;
  historicalRate: number;
  efficiencyMargin: number;
  recentGames: { date: string; value: number; minutes: number }[];
  hitRate: { hits: number; total: number; percentage: number };
  paceImpact: number;
  fatigueImpact: number;
  opponentDefenseRank: number | null;
  verdict: 'FAVORABLE' | 'NEUTRAL' | 'UNFAVORABLE';
  verdictReason: string;
}

interface UsageProjectionCardProps {
  projection: UsageProjection;
  legDescription: string;
}

// Calculate confidence score from projection data
const calculateConfidenceScore = (projection: UsageProjection): number => {
  let score = 50;
  
  // Hit rate contribution (40% weight)
  if (projection.hitRate.percentage >= 70) score += 20;
  else if (projection.hitRate.percentage >= 60) score += 12;
  else if (projection.hitRate.percentage >= 50) score += 5;
  else if (projection.hitRate.percentage < 40) score -= 10;
  
  // Efficiency margin (30% weight)
  if (projection.efficiencyMargin >= 10) score += 15;
  else if (projection.efficiencyMargin >= 5) score += 10;
  else if (projection.efficiencyMargin >= 0) score += 5;
  else if (projection.efficiencyMargin < -10) score -= 10;
  
  // Verdict boost (20% weight)
  if (projection.verdict === 'FAVORABLE') score += 10;
  else if (projection.verdict === 'UNFAVORABLE') score -= 10;
  
  // Pace/fatigue adjustments (10% weight)
  if (projection.paceImpact > 0) score += 3;
  if (projection.fatigueImpact > 0) score += 3;
  if (projection.fatigueImpact < -5) score -= 5;
  
  return Math.max(0, Math.min(100, score));
};

export function UsageProjectionCard({ projection, legDescription }: UsageProjectionCardProps) {
  const getVerdictConfig = (verdict: string) => {
    switch (verdict) {
      case 'FAVORABLE':
        return { 
          icon: CheckCircle, 
          color: 'text-green-400', 
          bg: 'bg-green-500/10 border-green-500/30',
          label: 'Favorable Usage'
        };
      case 'UNFAVORABLE':
        return { 
          icon: XCircle, 
          color: 'text-red-400', 
          bg: 'bg-red-500/10 border-red-500/30',
          label: 'Unfavorable Usage'
        };
      default:
        return { 
          icon: Minus, 
          color: 'text-yellow-400', 
          bg: 'bg-yellow-500/10 border-yellow-500/30',
          label: 'Neutral Usage'
        };
    }
  };

  const verdictConfig = getVerdictConfig(projection.verdict);
  const VerdictIcon = verdictConfig.icon;

  const formatPropType = (type: string) => {
    const typeMap: Record<string, string> = {
      'points': 'PTS',
      'rebounds': 'REB',
      'assists': 'AST',
      'threes': '3PM',
      'blocks': 'BLK',
      'steals': 'STL',
    };
    return typeMap[type.toLowerCase()] || type.toUpperCase();
  };

  const confidenceScore = calculateConfidenceScore(projection);
  
  const getConfidenceLabel = (score: number) => {
    if (score >= 75) return { label: 'ELITE', color: 'text-green-400', ringColor: 'text-green-500' };
    if (score >= 60) return { label: 'HIGH', color: 'text-green-400', ringColor: 'text-green-500' };
    if (score >= 45) return { label: 'MEDIUM', color: 'text-yellow-400', ringColor: 'text-yellow-500' };
    return { label: 'LOW', color: 'text-red-400', ringColor: 'text-red-500' };
  };
  
  const confidenceConfig = getConfidenceLabel(confidenceScore);

  return (
    <Card className={`border ${verdictConfig.bg}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Usage Projection
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Mini confidence gauge */}
            <div className="relative w-10 h-10">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-muted/30"
                  stroke="currentColor"
                  strokeWidth="3"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className={confidenceConfig.ringColor}
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={`${confidenceScore}, 100`}
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className={`text-[10px] font-bold ${confidenceConfig.color}`}>{confidenceScore}%</span>
              </div>
            </div>
            <Badge variant="outline" className={`${verdictConfig.color} border-current`}>
              <VerdictIcon className="h-3 w-3 mr-1" />
              {verdictConfig.label}
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground truncate">{legDescription}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Minutes Projection */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />
              Projected Minutes
            </span>
            <span className="font-mono font-medium">
              {projection.projectedMinutes.min}-{projection.projectedMinutes.max} min
            </span>
          </div>
          <div className="relative h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className="absolute h-full bg-primary/30 rounded-full"
              style={{ 
                left: `${(projection.projectedMinutes.min / 48) * 100}%`,
                width: `${((projection.projectedMinutes.max - projection.projectedMinutes.min) / 48) * 100}%`
              }}
            />
            <div 
              className="absolute h-full w-1 bg-primary rounded-full"
              style={{ left: `${(projection.projectedMinutes.avg / 48) * 100}%` }}
            />
          </div>
          <p className="text-xs text-center text-muted-foreground">
            Avg: {projection.projectedMinutes.avg} min/game
          </p>
        </div>

        {/* Production Rate Comparison */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-2 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Target className="h-3 w-3" />
              Required Rate
            </p>
            <p className="font-mono text-sm font-medium">
              {projection.requiredRate != null 
                ? `${projection.requiredRate.toFixed(2)} ${formatPropType(projection.propType)}/min`
                : '— (no data)'}
            </p>
            <p className="text-xs text-muted-foreground">
              {projection.requiredRate != null 
                ? `(${projection.line} ÷ ${projection.projectedMinutes.avg} min)`
                : 'Insufficient minutes data'}
            </p>
          </div>
          <div className="p-2 bg-muted/50 rounded-lg">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Historical Rate
            </p>
            <p className="font-mono text-sm font-medium">
              {projection.historicalRate != null 
                ? `${projection.historicalRate.toFixed(2)} ${formatPropType(projection.propType)}/min`
                : '— (no data)'}
            </p>
            {projection.historicalRate != null ? (
              <p className={`text-xs ${projection.efficiencyMargin >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {projection.efficiencyMargin >= 0 ? '+' : ''}{projection.efficiencyMargin.toFixed(1)}% margin
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Historical data unavailable</p>
            )}
          </div>
        </div>

        {/* Hit Rate */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Hit Rate (Last {projection.hitRate.total} Games)</span>
            <span className={`font-medium ${projection.hitRate.percentage >= 60 ? 'text-green-400' : projection.hitRate.percentage <= 40 ? 'text-red-400' : 'text-yellow-400'}`}>
              {projection.hitRate.hits}/{projection.hitRate.total} ({projection.hitRate.percentage}%)
            </span>
          </div>
          <Progress 
            value={projection.hitRate.percentage} 
            className="h-2"
          />
        </div>

        {/* Recent Games */}
        {projection.recentGames.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Recent Performance</p>
            <div className="flex gap-1">
              {projection.recentGames.map((game, idx) => (
                <div 
                  key={idx}
                  className={`flex-1 p-1.5 rounded text-center text-xs ${
                    game.value > projection.line 
                      ? 'bg-green-500/20 text-green-400' 
                      : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  <p className="font-mono font-medium">{game.value}</p>
                  <p className="text-[10px] opacity-70">{game.minutes}m</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Adjustments */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          {projection.paceImpact !== 0 && (
            <div className="p-1.5 bg-muted/30 rounded text-center">
              <Zap className={`h-3 w-3 mx-auto mb-0.5 ${projection.paceImpact > 0 ? 'text-green-400' : 'text-red-400'}`} />
              <p className={projection.paceImpact > 0 ? 'text-green-400' : 'text-red-400'}>
                {projection.paceImpact > 0 ? '+' : ''}{projection.paceImpact}%
              </p>
              <p className="text-muted-foreground text-[10px]">Pace</p>
            </div>
          )}
          {projection.fatigueImpact !== 0 && (
            <div className="p-1.5 bg-muted/30 rounded text-center">
              <TrendingDown className={`h-3 w-3 mx-auto mb-0.5 ${projection.fatigueImpact > 0 ? 'text-green-400' : 'text-red-400'}`} />
              <p className={projection.fatigueImpact > 0 ? 'text-green-400' : 'text-red-400'}>
                {projection.fatigueImpact > 0 ? '+' : ''}{projection.fatigueImpact}%
              </p>
              <p className="text-muted-foreground text-[10px]">Fatigue</p>
            </div>
          )}
          {projection.opponentDefenseRank && (
            <div className="p-1.5 bg-muted/30 rounded text-center">
              <Shield className="h-3 w-3 mx-auto mb-0.5 text-muted-foreground" />
              <p className="font-medium">#{projection.opponentDefenseRank}</p>
              <p className="text-muted-foreground text-[10px]">Def Rank</p>
            </div>
          )}
        </div>

        {/* Verdict Reason */}
        <p className="text-xs text-muted-foreground italic border-t border-border pt-2">
          {projection.verdictReason}
        </p>
      </CardContent>
    </Card>
  );
}

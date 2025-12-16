import { Badge } from '@/components/ui/badge';
import { FeedCard } from '@/components/FeedCard';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Brain, 
  TrendingUp, 
  AlertTriangle, 
  Activity, 
  Target,
  CheckCircle,
  XCircle,
  Zap,
  Shield
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface LegAnalysis {
  legDescription: string;
  parlayIndex: number;
  odds: number;
  sharpAlignment: boolean;
  sharpMovements: {
    recommendation: string;
    priceChange: number;
    isSharp: boolean;
    confidence: number;
  }[];
  unifiedScore: number | null;
  pvsTier: string | null;
  juicedDirection: string | null;
  juiceLevel: string | null;
  isTrap: boolean;
  trapScore: number | null;
  fatigueImpact: {
    homeFatigue: number;
    awayFatigue: number;
    recommendation: string;
  } | null;
}

interface ParlayMetric {
  parlayIndex: number;
  totalLegs: number;
  sharpAlignedLegs: number;
  trapLegs: number;
  juicedLegs: number;
  fatigueAlertLegs: number;
  sharpAlignmentScore: number;
  trapRisk: number;
}

interface AIAnalysis {
  recommendation: string;
  parlayGrades?: { parlayIndex: number; grade: string; reasoning: string }[];
  sharpInsight?: string;
  trapWarnings?: string[];
  fatigueAlerts?: string[];
  edgeAnalysis?: string;
  confidence?: string;
}

interface AICompareInsightsProps {
  aiAnalysis: AIAnalysis | null;
  legAnalysis: LegAnalysis[];
  parlayMetrics: ParlayMetric[];
  sharpDataCounts: {
    lineMovements: number;
    unifiedProps: number;
    juicedProps: number;
    trapAnalysis: number;
    fatigueScores: number;
  };
  isLoading?: boolean;
}

export function AICompareInsights({ 
  aiAnalysis, 
  legAnalysis, 
  parlayMetrics,
  sharpDataCounts,
  isLoading 
}: AICompareInsightsProps) {
  if (isLoading) {
    return (
      <FeedCard className="p-4">
        <div className="flex items-center gap-2 mb-4">
          <Brain className="w-5 h-5 text-primary animate-pulse" />
          <span className="font-display text-sm">AI ANALYSIS</span>
          <Badge variant="outline" className="text-xs">Loading...</Badge>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </FeedCard>
    );
  }

  const getGradeColor = (grade: string) => {
    const g = grade.toUpperCase();
    if (g.startsWith('A')) return 'text-neon-green bg-neon-green/10 border-neon-green/30';
    if (g.startsWith('B')) return 'text-primary bg-primary/10 border-primary/30';
    if (g.startsWith('C')) return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30';
    if (g.startsWith('D')) return 'text-orange-500 bg-orange-500/10 border-orange-500/30';
    return 'text-neon-red bg-neon-red/10 border-neon-red/30';
  };

  const getConfidenceColor = (conf?: string) => {
    if (conf === 'high') return 'bg-neon-green/20 text-neon-green border-neon-green/30';
    if (conf === 'medium') return 'bg-primary/20 text-primary border-primary/30';
    return 'bg-muted text-muted-foreground';
  };

  return (
    <div className="space-y-4">
      {/* AI Recommendation Header */}
      <FeedCard className="p-4 border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-display text-sm text-primary">AI SHARP ANALYSIS</h3>
              {aiAnalysis?.confidence && (
                <Badge variant="outline" className={cn("text-xs", getConfidenceColor(aiAnalysis.confidence))}>
                  {aiAnalysis.confidence.toUpperCase()} CONFIDENCE
                </Badge>
              )}
            </div>
            <p className="text-sm text-foreground leading-relaxed">
              {aiAnalysis?.recommendation || 'No AI recommendation available'}
            </p>
          </div>
        </div>
      </FeedCard>

      {/* Parlay Grades */}
      {aiAnalysis?.parlayGrades && aiAnalysis.parlayGrades.length > 0 && (
        <FeedCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-sm">Parlay Grades</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {aiAnalysis.parlayGrades.map((pg) => (
              <div 
                key={pg.parlayIndex}
                className={cn(
                  "rounded-lg p-3 border",
                  getGradeColor(pg.grade)
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium text-sm">Parlay {pg.parlayIndex + 1}</span>
                  <span className="font-display text-lg">{pg.grade}</span>
                </div>
                <p className="text-xs opacity-80">{pg.reasoning}</p>
              </div>
            ))}
          </div>
        </FeedCard>
      )}

      {/* Sharp Money Insight */}
      {aiAnalysis?.sharpInsight && (
        <FeedCard className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-neon-green" />
            <span className="font-medium text-sm">Sharp Money Insight</span>
          </div>
          <p className="text-sm text-muted-foreground">{aiAnalysis.sharpInsight}</p>
        </FeedCard>
      )}

      {/* Trap Warnings */}
      {aiAnalysis?.trapWarnings && aiAnalysis.trapWarnings.length > 0 && (
        <FeedCard className="p-4 border-neon-red/30 bg-neon-red/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-neon-red" />
            <span className="font-medium text-sm text-neon-red">Trap Warnings</span>
          </div>
          <ul className="space-y-1">
            {aiAnalysis.trapWarnings.map((warning, idx) => (
              <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                <XCircle className="w-3 h-3 text-neon-red mt-1 flex-shrink-0" />
                {warning}
              </li>
            ))}
          </ul>
        </FeedCard>
      )}

      {/* Fatigue Alerts */}
      {aiAnalysis?.fatigueAlerts && aiAnalysis.fatigueAlerts.length > 0 && (
        <FeedCard className="p-4 border-yellow-500/30 bg-yellow-500/5">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-yellow-500" />
            <span className="font-medium text-sm text-yellow-500">Fatigue Alerts</span>
          </div>
          <ul className="space-y-1">
            {aiAnalysis.fatigueAlerts.map((alert, idx) => (
              <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                <Activity className="w-3 h-3 text-yellow-500 mt-1 flex-shrink-0" />
                {alert}
              </li>
            ))}
          </ul>
        </FeedCard>
      )}

      {/* Edge Analysis */}
      {aiAnalysis?.edgeAnalysis && (
        <FeedCard className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm">Edge Analysis</span>
          </div>
          <p className="text-sm text-muted-foreground">{aiAnalysis.edgeAnalysis}</p>
        </FeedCard>
      )}

      {/* Per-Parlay Metrics */}
      <FeedCard className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">Sharp Data Cross-Reference</span>
        </div>
        <div className="space-y-3">
          {parlayMetrics.map((pm) => (
            <div key={pm.parlayIndex} className="bg-muted/30 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm">Parlay {pm.parlayIndex + 1}</span>
                <Badge variant="outline" className="text-xs">
                  {pm.totalLegs} legs
                </Badge>
              </div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div className="text-center">
                  <div className={cn(
                    "font-bold",
                    pm.sharpAlignedLegs > 0 ? "text-neon-green" : "text-muted-foreground"
                  )}>
                    {pm.sharpAlignedLegs}
                  </div>
                  <div className="text-muted-foreground">Sharp</div>
                </div>
                <div className="text-center">
                  <div className={cn(
                    "font-bold",
                    pm.trapLegs > 0 ? "text-neon-red" : "text-muted-foreground"
                  )}>
                    {pm.trapLegs}
                  </div>
                  <div className="text-muted-foreground">Traps</div>
                </div>
                <div className="text-center">
                  <div className={cn(
                    "font-bold",
                    pm.juicedLegs > 0 ? "text-primary" : "text-muted-foreground"
                  )}>
                    {pm.juicedLegs}
                  </div>
                  <div className="text-muted-foreground">Juiced</div>
                </div>
                <div className="text-center">
                  <div className={cn(
                    "font-bold",
                    pm.fatigueAlertLegs > 0 ? "text-yellow-500" : "text-muted-foreground"
                  )}>
                    {pm.fatigueAlertLegs}
                  </div>
                  <div className="text-muted-foreground">Fatigue</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </FeedCard>

      {/* Leg-by-Leg Breakdown */}
      <FeedCard className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">Leg Analysis</span>
          <Badge variant="outline" className="text-xs ml-auto">
            {legAnalysis.length} legs
          </Badge>
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {legAnalysis.map((leg, idx) => (
            <div 
              key={idx} 
              className={cn(
                "p-2 rounded-lg text-xs border",
                leg.isTrap ? "border-neon-red/30 bg-neon-red/5" :
                leg.sharpAlignment ? "border-neon-green/30 bg-neon-green/5" :
                "border-border bg-muted/20"
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-muted-foreground">P{leg.parlayIndex + 1}</span>
                <span className="flex-1 truncate">{leg.legDescription}</span>
                <span className="font-mono">{leg.odds > 0 ? '+' : ''}{leg.odds}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {leg.sharpAlignment && (
                  <Badge className="text-[10px] bg-neon-green/20 text-neon-green border-neon-green/30">
                    ✓ Sharp
                  </Badge>
                )}
                {leg.isTrap && (
                  <Badge className="text-[10px] bg-neon-red/20 text-neon-red border-neon-red/30">
                    ⚠️ Trap
                  </Badge>
                )}
                {leg.pvsTier && (
                  <Badge className="text-[10px] bg-primary/20 text-primary border-primary/30">
                    PVS: {leg.pvsTier}
                  </Badge>
                )}
                {leg.juicedDirection && (
                  <Badge className="text-[10px] bg-blue-500/20 text-blue-400 border-blue-500/30">
                    💧 {leg.juiceLevel}
                  </Badge>
                )}
                {leg.fatigueImpact && (
                  <Badge className="text-[10px] bg-yellow-500/20 text-yellow-500 border-yellow-500/30">
                    🏃 Fatigue
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </FeedCard>

      {/* Data Sources Footer */}
      <div className="text-center text-xs text-muted-foreground">
        <p>Cross-referenced against {sharpDataCounts.lineMovements + sharpDataCounts.unifiedProps + sharpDataCounts.juicedProps} sharp data points</p>
      </div>
    </div>
  );
}

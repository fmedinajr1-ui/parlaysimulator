import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, CheckCircle, XCircle, Zap, TrendingUp, Shield } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MedianLockCandidate {
  id: string;
  player_name: string;
  team_name: string;
  prop_type: string;
  book_line: number;
  classification: 'LOCK' | 'STRONG' | 'BLOCK';
  confidence_score: number;
  hit_rate: number;
  hit_rate_last_5: number;
  median_points: number;
  median_minutes: number;
  raw_edge: number;
  adjusted_edge: number;
  defense_adjustment: number;
  split_edge: number;
  juice_lag_bonus: number;
  is_shock_flagged: boolean;
  shock_reasons: string[];
  shock_passed_validation: boolean;
  passed_checks: string[];
  failed_checks: string[];
  block_reason?: string;
}

interface MedianLockCandidateCardProps {
  candidate: MedianLockCandidate;
  compact?: boolean;
}

export function MedianLockCandidateCard({ candidate, compact = false }: MedianLockCandidateCardProps) {
  const getClassificationBadge = () => {
    switch (candidate.classification) {
      case 'LOCK':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">🔒 LOCK</Badge>;
      case 'STRONG':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">💪 STRONG</Badge>;
      case 'BLOCK':
        return <Badge variant="destructive" className="opacity-70">⛔ BLOCK</Badge>;
    }
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 85) return 'text-green-400';
    if (score >= 75) return 'text-blue-400';
    if (score >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  if (compact) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{candidate.player_name}</span>
              {getClassificationBadge()}
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-sm font-bold ${getConfidenceColor(candidate.confidence_score)}`}>
                {candidate.confidence_score.toFixed(0)}
              </span>
              <span className="text-xs text-muted-foreground">
                {(candidate.hit_rate * 100).toFixed(0)}% HR
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`bg-card/80 backdrop-blur-sm border-border/50 ${
      candidate.classification === 'LOCK' ? 'ring-1 ring-green-500/30' : 
      candidate.classification === 'STRONG' ? 'ring-1 ring-blue-500/20' : ''
    }`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">{candidate.player_name}</CardTitle>
            <span className="text-xs text-muted-foreground">{candidate.team_name}</span>
          </div>
          {getClassificationBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Confidence Score */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Confidence Score</span>
            <span className={`text-xl font-bold ${getConfidenceColor(candidate.confidence_score)}`}>
              {candidate.confidence_score.toFixed(1)}
            </span>
          </div>
          <Progress 
            value={Math.min(100, candidate.confidence_score)} 
            className="h-2"
          />
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-lg font-bold text-primary">{(candidate.hit_rate * 100).toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">Hit Rate</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-lg font-bold text-emerald-400">+{candidate.adjusted_edge.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground">Adj Edge</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-lg font-bold">{candidate.median_minutes.toFixed(0)}</div>
            <div className="text-xs text-muted-foreground">Med Min</div>
          </div>
        </div>

        {/* Edge Breakdown */}
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Median Points</span>
            <span className="font-medium">{candidate.median_points.toFixed(1)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Raw Edge</span>
            <span className="font-medium">+{candidate.raw_edge.toFixed(1)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Defense Adj</span>
            <span className={`font-medium ${candidate.defense_adjustment > 0 ? 'text-green-400' : candidate.defense_adjustment < 0 ? 'text-red-400' : ''}`}>
              {candidate.defense_adjustment > 0 ? '+' : ''}{candidate.defense_adjustment.toFixed(1)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Split Edge</span>
            <span className="font-medium">+{candidate.split_edge.toFixed(1)}</span>
          </div>
          {candidate.juice_lag_bonus > 0 && (
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground flex items-center gap-1">
                <Zap className="h-3 w-3 text-yellow-400" /> Juice Lag
              </span>
              <span className="font-medium text-yellow-400">+{candidate.juice_lag_bonus.toFixed(1)}</span>
            </div>
          )}
        </div>

        {/* Shock Flag Warning */}
        {candidate.is_shock_flagged && (
          <div className={`rounded-lg p-2 text-sm ${
            candidate.shock_passed_validation 
              ? 'bg-yellow-500/10 border border-yellow-500/30' 
              : 'bg-red-500/10 border border-red-500/30'
          }`}>
            <div className="flex items-center gap-1 font-medium mb-1">
              <AlertTriangle className={`h-4 w-4 ${candidate.shock_passed_validation ? 'text-yellow-400' : 'text-red-400'}`} />
              <span>Shock Flag {candidate.shock_passed_validation ? '(Passed)' : '(Failed)'}</span>
            </div>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {candidate.shock_reasons.map((reason, i) => (
                <li key={i}>• {reason}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Checks */}
        <TooltipProvider>
          <div className="flex flex-wrap gap-1">
            {candidate.passed_checks.slice(0, 3).map((check, i) => (
              <Tooltip key={i}>
                <TooltipTrigger>
                  <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-400 border-green-500/20">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    ✓
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{check}</p>
                </TooltipContent>
              </Tooltip>
            ))}
            {candidate.failed_checks.slice(0, 2).map((check, i) => (
              <Tooltip key={i}>
                <TooltipTrigger>
                  <Badge variant="secondary" className="text-xs bg-red-500/10 text-red-400 border-red-500/20">
                    <XCircle className="h-3 w-3 mr-1" />
                    ✗
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">{check}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>

        {candidate.block_reason && (
          <div className="text-xs text-red-400 flex items-center gap-1">
            <XCircle className="h-3 w-3" />
            Blocked: {candidate.block_reason}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

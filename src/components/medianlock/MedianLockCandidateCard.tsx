import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, CheckCircle, XCircle, Zap } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GameStatusBadge } from "./GameStatusBadge";
import type { MedianLockCandidate } from "@/hooks/useMedianLockRealtime";

interface MedianLockCandidateCardProps {
  candidate: MedianLockCandidate;
  compact?: boolean;
}

export function MedianLockCandidateCard({ candidate, compact = false }: MedianLockCandidateCardProps) {
  const formatPropType = (propType: string) => {
    const typeMap: Record<string, string> = {
      'player_points': 'Points',
      'player_rebounds': 'Rebounds',
      'player_assists': 'Assists',
      'player_threes': '3-Pointers',
      'player_pra': 'PRA',
      'player_pts_rebs': 'Pts+Rebs',
      'player_pts_asts': 'Pts+Asts',
      'player_rebs_asts': 'Rebs+Asts',
      'player_steals': 'Steals',
      'player_blocks': 'Blocks',
      'player_turnovers': 'Turnovers',
    };
    return typeMap[propType] || propType.replace('player_', '').replace(/_/g, ' ');
  };

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

  const getParlayGradeBadge = () => {
    if (!candidate.parlay_grade) return null;
    return (
      <Badge className="bg-emerald-500/30 text-emerald-300 border-emerald-500/50 font-bold">
        🏆 PARLAY
      </Badge>
    );
  };

  const getBetSideBadge = () => {
    if (!candidate.bet_side || candidate.bet_side === 'PASS') return null;
    return (
      <Badge className={`font-bold ${
        candidate.bet_side === 'OVER' 
          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
          : 'bg-orange-500/20 text-orange-400 border-orange-500/30'
      }`}>
        {candidate.bet_side === 'OVER' ? '📈' : '📉'} {candidate.bet_side}
      </Badge>
    );
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 85) return 'text-green-400';
    if (score >= 75) return 'text-blue-400';
    if (score >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  const isFinal = candidate.game_status === 'final';
  const isLive = candidate.game_status === 'live';

  if (compact) {
    return (
      <Card className={`bg-card/50 border-border/50 ${isFinal ? 'opacity-60' : ''}`}>
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{candidate.player_name}</span>
              <Badge variant="outline" className="text-xs px-1">{formatPropType(candidate.prop_type)}</Badge>
              {getClassificationBadge()}
              {getBetSideBadge()}
              <GameStatusBadge 
                status={candidate.game_status}
                outcome={candidate.outcome}
                compact
              />
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
    <Card className={`bg-card/80 backdrop-blur-sm border-border/50 relative overflow-hidden transition-opacity ${
      candidate.classification === 'LOCK' ? 'ring-1 ring-green-500/30' : 
      candidate.classification === 'STRONG' ? 'ring-1 ring-blue-500/20' : ''
    } ${isFinal ? 'opacity-70' : ''}`}>
      {/* Outcome overlay */}
      {isFinal && candidate.outcome && (
        <div className={`absolute inset-0 pointer-events-none ${
          candidate.outcome === 'hit' 
            ? 'bg-gradient-to-r from-green-500/10 to-transparent' 
            : candidate.outcome === 'miss'
            ? 'bg-gradient-to-r from-red-500/10 to-transparent'
            : ''
        }`} />
      )}

      {/* Live indicator pulse */}
      {isLive && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-500 via-red-400 to-red-500 animate-pulse" />
      )}

      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-lg">{candidate.player_name}</CardTitle>
            <Badge variant="outline" className="text-xs">{formatPropType(candidate.prop_type)}</Badge>
            <span className="text-xs text-muted-foreground">{candidate.team_name}</span>
          </div>
          <div className="flex items-center gap-2">
            <GameStatusBadge 
              status={candidate.game_status}
              outcome={candidate.outcome}
              compact
            />
            {getParlayGradeBadge()}
            {getBetSideBadge()}
            {getClassificationBadge()}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Game Status Section */}
        {(isLive || isFinal) && (
          <GameStatusBadge
            status={candidate.game_status}
            gameStartTime={candidate.game_start_time}
            homeTeam={candidate.home_team}
            awayTeam={candidate.away_team}
            homeScore={candidate.home_score}
            awayScore={candidate.away_score}
            clock={candidate.game_clock}
            period={candidate.game_period}
            outcome={candidate.outcome}
            actualValue={candidate.actual_value}
          />
        )}

        {/* Result vs Prediction */}
        {isFinal && candidate.actual_value !== undefined && (
          <div className={`flex items-center justify-between p-2 rounded-lg ${
            candidate.outcome === 'hit' 
              ? 'bg-green-500/10 border border-green-500/30' 
              : 'bg-red-500/10 border border-red-500/30'
          }`}>
            <div className="flex items-center gap-2">
              {candidate.outcome === 'hit' ? (
                <CheckCircle className="h-5 w-5 text-green-400" />
              ) : (
                <XCircle className="h-5 w-5 text-red-400" />
              )}
              <span className="text-sm font-medium">
                {candidate.outcome === 'hit' ? 'HIT!' : 'Missed'}
              </span>
            </div>
            <div className="text-right">
              <div className="text-sm">
                <span className="text-muted-foreground">Actual: </span>
                <span className="font-bold">{candidate.actual_value}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Line: {candidate.book_line} ({candidate.bet_side})
              </div>
            </div>
          </div>
        )}

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

        {/* Edge Breakdown - Hide for final games */}
        {!isFinal && (
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Median {formatPropType(candidate.prop_type)}</span>
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
        )}

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

        {/* Checks - Hide for final games */}
        {!isFinal && (
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
        )}

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

import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  TrendingUp, 
  AlertTriangle, 
  Target, 
  Plus,
  ChevronDown,
  ChevronUp,
  Zap,
  Shield,
  Activity
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { useParlayBuilder } from '@/contexts/ParlayBuilderContext';
import { UpsetScoreGauge } from './UpsetScoreGauge';
import { ChaosModeIndicator } from './ChaosModeIndicator';
import { SignalBreakdown } from './SignalBreakdown';
import { LiveOddsIndicator } from './LiveOddsIndicator';
import type { GodModeUpsetPrediction } from '@/types/god-mode';
import { format } from 'date-fns';

interface GodModeUpsetCardProps {
  prediction: GodModeUpsetPrediction;
  className?: string;
}

export function GodModeUpsetCard({ prediction, className }: GodModeUpsetCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { addLeg, hasLeg } = useParlayBuilder();

  const isAdded = hasLeg(`${prediction.event_id}-${prediction.underdog}`);

  const handleAddToParlay = () => {
    if (!isAdded) {
      addLeg({
        description: `${prediction.underdog} ML vs ${prediction.favorite}`,
        odds: prediction.underdog_odds,
        source: 'godmode',
        sport: prediction.sport,
        eventId: prediction.event_id,
        confidenceScore: prediction.final_upset_score,
        sourceData: {
          upsetProbability: prediction.upset_probability,
          confidence: prediction.confidence,
          riskLevel: prediction.risk_level,
          chaosModeActive: prediction.chaos_mode_active,
          sharpPct: prediction.sharp_pct,
          chessEv: prediction.chess_ev
        }
      });
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high': return 'bg-chart-2 text-chart-2-foreground';
      case 'medium': return 'bg-chart-4 text-chart-4-foreground';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const getSuggestionBadge = () => {
    switch (prediction.suggestion) {
      case 'play':
        return <Badge className="bg-chart-2 text-white">🎯 PLAY</Badge>;
      case 'parlay_add':
        return <Badge className="bg-chart-1 text-white">📊 PARLAY ADD</Badge>;
      case 'upset_alert':
        return <Badge className="bg-chart-4 text-chart-4-foreground">⚡ UPSET ALERT</Badge>;
      default:
        return <Badge variant="outline">AVOID</Badge>;
    }
  };

  const formatOdds = (odds: number) => {
    return odds > 0 ? `+${odds}` : odds.toString();
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <Card className={cn(
        'relative overflow-hidden transition-all min-w-[320px]',
        prediction.chaos_mode_active && 'ring-2 ring-purple-500/50',
        prediction.confidence === 'high' && 'ring-2 ring-chart-2/50',
        className
      )}>
        {/* Chaos mode glow effect */}
        {prediction.chaos_mode_active && (
          <motion.div
            className="absolute inset-0 bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-orange-500/10"
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ repeat: Infinity, duration: 2 }}
          />
        )}

        <CardHeader className="relative pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <span className="uppercase truncate max-w-[120px]" title={prediction.sport.replace('_', ' ')}>{prediction.sport.replace('americanfootball_', '').replace('basketball_', '').toUpperCase()}</span>
                <span>•</span>
                <span>{format(new Date(prediction.commence_time), 'MMM d, h:mm a')}</span>
              </div>

              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-foreground">
                  {prediction.underdog}
                </h3>
                <span className="text-xl font-bold text-chart-2">
                  {formatOdds(prediction.underdog_odds)}
                </span>
              </div>

              <p className="text-sm text-muted-foreground">
                vs {prediction.favorite} ({formatOdds(prediction.favorite_odds)})
              </p>
            </div>

            <UpsetScoreGauge score={prediction.final_upset_score} size="sm" />
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-3">
            {getSuggestionBadge()}
            <Badge className={getConfidenceColor(prediction.confidence)}>
              {prediction.confidence.toUpperCase()}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Shield className="h-3 w-3" />
              Risk {prediction.risk_level}/5
            </Badge>
            {prediction.trap_on_favorite && (
              <Badge className="bg-destructive/20 text-destructive gap-1">
                <AlertTriangle className="h-3 w-3" />
                TRAP
              </Badge>
            )}
            {prediction.chaos_mode_active && (
              <ChaosModeIndicator 
                chaosPercentage={prediction.chaos_percentage} 
                isActive={true} 
                variant="compact" 
              />
            )}
          </div>
        </CardHeader>

        <CardContent className="relative space-y-4">
          {/* Live odds indicator */}
          <LiveOddsIndicator
            isLive={prediction.is_live}
            lastUpdate={prediction.last_odds_update}
            direction={prediction.odds_change_direction}
            previousOdds={prediction.previous_odds ?? undefined}
            currentOdds={prediction.underdog_odds}
          />

          {/* Key stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-muted/50 p-3 text-center min-w-0">
              <div className="text-xl font-bold text-chart-2">
                {Math.round(prediction.upset_probability)}%
              </div>
              <div className="text-xs text-muted-foreground whitespace-nowrap">Upset Prob</div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center min-w-0">
              <div className="text-xl font-bold text-chart-1">
                {Math.round(prediction.sharp_pct)}%
              </div>
              <div className="text-xs text-muted-foreground whitespace-nowrap">Sharp %</div>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center min-w-0">
              <div className="text-xl font-bold text-chart-4">
                {Math.round(prediction.chess_ev)}
              </div>
              <div className="text-xs text-muted-foreground whitespace-nowrap">CHESS EV</div>
            </div>
          </div>

          {/* Reasons */}
          {prediction.reasons.length > 0 && (
            <div className="space-y-1">
              {prediction.reasons.slice(0, expanded ? undefined : 2).map((reason, i) => (
                <div 
                  key={i} 
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <Zap className="h-3 w-3 text-chart-2 shrink-0" />
                  {reason}
                </div>
              ))}
            </div>
          )}

          {/* Expanded content */}
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="space-y-4 pt-2 border-t border-border"
            >
              {/* Signal breakdown */}
              <SignalBreakdown signals={prediction.signals} />

              {/* AI Reasoning */}
              {prediction.ai_reasoning && (
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="h-4 w-4 text-chart-1" />
                    <span className="text-sm font-semibold">AI Analysis</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {prediction.ai_reasoning}
                  </p>
                </div>
              )}

              {/* Parlay impact */}
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="h-4 w-4 text-chart-2" />
                  <span className="text-sm font-semibold">Parlay Impact</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-sm font-bold text-chart-2">
                      {prediction.parlay_impact.evImpact > 0 ? '+' : ''}
                      {prediction.parlay_impact.evImpact.toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground">EV Impact</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-chart-1">
                      {prediction.parlay_impact.riskReduction > 0 ? '+' : ''}
                      {prediction.parlay_impact.riskReduction}%
                    </div>
                    <div className="text-xs text-muted-foreground">Risk Adj</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-chart-4">
                      +{prediction.parlay_impact.synergyBoost}%
                    </div>
                    <div className="text-xs text-muted-foreground">Synergy</div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <Button
              variant={isAdded ? 'secondary' : 'default'}
              size="sm"
              className="flex-1 gap-2 whitespace-nowrap"
              onClick={handleAddToParlay}
              disabled={isAdded}
            >
              <Plus className="h-4 w-4 shrink-0" />
              <span className="truncate">{isAdded ? 'Added' : 'Add to Parlay'}</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(!expanded)}
              className="gap-1 shrink-0"
            >
              {expanded ? (
                <>Less <ChevronUp className="h-4 w-4" /></>
              ) : (
                <>More <ChevronDown className="h-4 w-4" /></>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

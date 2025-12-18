import { useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AccuracyBadge } from '@/components/ui/accuracy-badge';
import { AddToParlayButton } from '@/components/parlay/AddToParlayButton';
import { MiniKellyIndicator } from './MiniKellyIndicator';
import { MiniEnsembleScore } from './MiniEnsembleScore';
import { extractBestBetSignals } from '@/lib/ensemble-engine';
import { Clock, Zap, TrendingDown, Trophy, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface BankrollSettings {
  bankrollAmount?: number;
  kellyMultiplier?: number;
  maxBetPercent?: number;
}

interface BestBetCardProps {
  type: 'nhl_sharp' | 'ncaab_steam' | 'fade_signal' | 'nba_fatigue' | 'nfl_fade' | 'nfl_caution' | 'nhl_caution';
  event: {
    id: string;
    event_id: string;
    description: string;
    sport: string;
    commence_time?: string;
    recommendation: string;
    confidence?: number;
    odds?: number;
    player_name?: string;
    outcome_name?: string;
    sharp_indicator?: string;
    trap_score?: number;
    fatigue_differential?: number;
  };
  accuracy: number;
  sampleSize: number;
  bankrollSettings?: BankrollSettings | null;
}

export function BestBetCard({ 
  type, 
  event, 
  accuracy, 
  sampleSize,
  bankrollSettings 
}: BestBetCardProps) {
  const getTypeConfig = () => {
    switch (type) {
      case 'nfl_fade':
        return {
          label: '🏈 NFL Fade',
          icon: <Trophy className="h-4 w-4" />,
          color: 'from-green-500/20 to-emerald-500/10',
          badgeColor: 'bg-green-500/20 text-green-400 border-green-500/30',
          source: 'sharp' as const,
          isTopPerformer: true
        };
      case 'nfl_caution':
        return {
          label: '🏈 NFL Caution',
          icon: <AlertTriangle className="h-4 w-4" />,
          color: 'from-yellow-500/20 to-amber-500/10',
          badgeColor: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
          source: 'sharp' as const,
          isTopPerformer: false
        };
      case 'nhl_caution':
        return {
          label: '🏒 NHL Caution',
          icon: <AlertTriangle className="h-4 w-4" />,
          color: 'from-cyan-500/20 to-blue-500/10',
          badgeColor: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
          source: 'sharp' as const,
          isTopPerformer: false
        };
      case 'nhl_sharp':
        return {
          label: '🏒 NHL Sharp',
          icon: <Zap className="h-4 w-4" />,
          color: 'from-blue-500/20 to-cyan-500/10',
          badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
          source: 'sharp' as const,
          isTopPerformer: false
        };
      case 'ncaab_steam':
        return {
          label: '🏀 NCAAB Fade',
          icon: <TrendingDown className="h-4 w-4" />,
          color: 'from-orange-500/20 to-amber-500/10',
          badgeColor: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
          source: 'sharp' as const,
          isTopPerformer: false
        };
      case 'fade_signal':
        return {
          label: 'Fade',
          icon: <TrendingDown className="h-4 w-4" />,
          color: 'from-red-500/20 to-pink-500/10',
          badgeColor: 'bg-red-500/20 text-red-400 border-red-500/30',
          source: 'sharp' as const,
          isTopPerformer: false
        };
      case 'nba_fatigue':
        return {
          label: '🏀 NBA Fatigue',
          icon: <Zap className="h-4 w-4" />,
          color: 'from-purple-500/20 to-violet-500/10',
          badgeColor: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
          source: 'manual' as const,
          isTopPerformer: false
        };
      default:
        return {
          label: 'Best Bet',
          icon: <Zap className="h-4 w-4" />,
          color: 'from-chart-1/20 to-chart-1/10',
          badgeColor: 'bg-chart-1/20 text-chart-1 border-chart-1/30',
          source: 'sharp' as const,
          isTopPerformer: false
        };
    }
  };

  const config = getTypeConfig();

  // Generate ensemble signals for this pick
  const ensembleSignals = useMemo(() => {
    return extractBestBetSignals({
      sharp_indicator: event.sharp_indicator,
      trap_score: event.trap_score,
      fatigue_differential: event.fatigue_differential,
      confidence: event.confidence,
      recommendation: event.recommendation
    }, type);
  }, [event, type]);

  // Calculate win probability from accuracy
  const winProbability = accuracy / 100;
  
  // Format sport display
  const formatSport = (sport: string) => {
    return sport
      .replace('basketball_', '')
      .replace('americanfootball_', '')
      .replace('icehockey_', '')
      .toUpperCase();
  };

  // Sample size confidence
  const getSampleConfidence = () => {
    if (sampleSize >= 200) return { label: 'High', color: 'text-green-400' };
    if (sampleSize >= 50) return { label: 'Good', color: 'text-yellow-400' };
    if (sampleSize >= 20) return { label: 'Low', color: 'text-orange-400' };
    return { label: 'Very Low', color: 'text-red-400' };
  };

  const sampleConfidence = getSampleConfidence();

  // Create description for parlay
  const parlayDescription = event.outcome_name 
    ? `${event.description} - ${event.outcome_name}`
    : event.description;

  return (
    <Card className={cn(
      'bg-gradient-to-br border-border/50 hover:border-border transition-all relative',
      config.color,
      config.isTopPerformer && 'ring-2 ring-green-500/30'
    )}>
      {config.isTopPerformer && (
        <div className="absolute -top-2 -right-2 bg-green-500 text-white text-xs px-2 py-0.5 rounded-full font-bold">
          TOP
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn('gap-1 border', config.badgeColor)}>
              {config.icon}
              {config.label}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {formatSport(event.sport)}
            </Badge>
          </div>
          <AccuracyBadge accuracy={accuracy} sampleSize={sampleSize} size="sm" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="font-semibold text-foreground">{event.description}</p>
          {event.player_name && (
            <p className="text-sm text-muted-foreground">{event.player_name}</p>
          )}
          {event.outcome_name && (
            <p className="text-sm font-medium text-chart-1">{event.outcome_name}</p>
          )}
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          {event.commence_time && (
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {format(new Date(event.commence_time), 'MMM d, h:mm a')}
            </div>
          )}
          {event.sharp_indicator && (
            <div className="flex items-center gap-1">
              <Zap className="h-3 w-3 text-chart-4" />
              {event.sharp_indicator}
            </div>
          )}
          {event.fatigue_differential && (
            <Badge variant="secondary" className="text-xs">
              Fatigue Diff: +{event.fatigue_differential}
            </Badge>
          )}
        </div>

        {/* Sample Size Warning */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Sample:</span>
          <span className={cn('font-medium', sampleConfidence.color)}>
            n={sampleSize} ({sampleConfidence.label})
          </span>
        </div>

        {/* Kelly & Ensemble Indicators */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/30">
          <MiniKellyIndicator 
            winProbability={winProbability}
            americanOdds={event.odds || -110}
            bankrollSettings={bankrollSettings}
          />
          <MiniEnsembleScore signals={ensembleSignals} />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          <div className="flex items-center gap-2">
            <Badge 
              variant={event.recommendation === 'fade' ? 'destructive' : 'default'}
              className="uppercase text-xs"
            >
              {event.recommendation}
            </Badge>
            {event.odds && (
              <span className={cn(
                'font-mono font-semibold',
                event.odds > 0 ? 'text-chart-2' : 'text-foreground'
              )}>
                {event.odds > 0 ? '+' : ''}{event.odds}
              </span>
            )}
          </div>
          <AddToParlayButton
            description={parlayDescription}
            odds={event.odds || -110}
            source={config.source}
            sport={event.sport}
            eventId={event.event_id}
            confidenceScore={event.confidence || accuracy / 100}
            sourceData={{
              type,
              recommendation: event.recommendation,
              sharp_indicator: event.sharp_indicator,
              trap_score: event.trap_score,
              fatigue_differential: event.fatigue_differential,
              accuracy,
              sampleSize
            }}
            variant="compact"
          />
        </div>
      </CardContent>
    </Card>
  );
}

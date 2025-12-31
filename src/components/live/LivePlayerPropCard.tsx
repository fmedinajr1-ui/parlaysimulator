import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, CheckCircle2, XCircle, Clock, Target } from 'lucide-react';
import { LegLiveProgress } from '@/hooks/useParlayLiveProgress';

interface LivePlayerPropCardProps {
  leg: LegLiveProgress;
  className?: string;
}

export function LivePlayerPropCard({ leg, className }: LivePlayerPropCardProps) {
  const {
    playerName,
    propType,
    line,
    side,
    currentValue,
    gameStatus,
    gameInfo,
    isHitting,
    isOnPace,
    projectedFinal,
    isPlayerProp,
    description,
    betType,
  } = leg;

  const progress = currentValue !== null && line > 0 ? Math.min((currentValue / line) * 100, 150) : 0;
  
  const getStatusColor = () => {
    if (gameStatus === 'scheduled') return 'text-muted-foreground';
    if (isHitting) return 'text-chart-2';
    if (isOnPace) return 'text-chart-4';
    return 'text-destructive';
  };

  const getStatusIcon = () => {
    if (gameStatus === 'scheduled') return <Clock className="w-4 h-4" />;
    if (gameStatus === 'final') {
      return isHitting ? 
        <CheckCircle2 className="w-4 h-4 text-chart-2" /> : 
        <XCircle className="w-4 h-4 text-destructive" />;
    }
    if (isHitting) return <CheckCircle2 className="w-4 h-4 text-chart-2" />;
    if (isOnPace) return <TrendingUp className="w-4 h-4 text-chart-4" />;
    return <TrendingDown className="w-4 h-4 text-destructive" />;
  };

  const getStatusText = () => {
    if (gameStatus === 'scheduled') return 'Upcoming';
    if (gameStatus === 'final') return isHitting ? 'HIT' : 'MISS';
    if (isHitting) return 'HITTING';
    if (isOnPace) return 'On Pace';
    return 'Behind';
  };

  const formatPropType = (type: string | undefined | null) => {
    if (!type) return '';
    return type
      .replace(/_/g, ' ')
      .replace(/player/i, '')
      .trim()
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  };

  // Render game bet (moneyline, spread, total) differently from player props
  if (!isPlayerProp) {
    return (
      <div className={cn('p-3 rounded-lg bg-muted/30 border border-border/30', className)}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">{description || 'Game Bet'}</p>
              <p className="text-xs text-muted-foreground">
                {betType ? betType.replace(/_/g, ' ').toUpperCase() : 'BET'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-xs text-muted-foreground">
              {gameInfo ? `${gameInfo.awayTeam} @ ${gameInfo.homeTeam}` : 'Pending'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('p-3 rounded-lg bg-muted/30 border border-border/30', className)}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-start gap-2">
          {getStatusIcon()}
          <div>
            <p className="font-medium text-sm">{playerName}</p>
            <p className="text-xs text-muted-foreground">
              {formatPropType(propType)} {side?.toUpperCase() || ''} {line}
            </p>
          </div>
        </div>
        <div className="text-right">
          {currentValue !== null ? (
            <>
              <div className="flex items-center gap-1 justify-end">
                <span className={cn('text-lg font-bold tabular-nums', getStatusColor())}>
                  {currentValue}
                </span>
                <span className="text-muted-foreground">/</span>
                <span className="text-sm text-muted-foreground">{line}</span>
              </div>
              <span className={cn('text-xs font-medium', getStatusColor())}>
                {getStatusText()}
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              {gameInfo ? `${gameInfo.awayTeam} @ ${gameInfo.homeTeam}` : 'Upcoming'}
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {gameStatus !== 'scheduled' && (
        <div className="space-y-1">
          <div className="relative h-2 bg-muted rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(progress, 100)}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className={cn(
                'absolute left-0 top-0 h-full rounded-full',
                isHitting ? 'bg-chart-2' : isOnPace ? 'bg-chart-4' : 'bg-primary'
              )}
            />
            {/* Line marker */}
            <div 
              className="absolute top-0 w-0.5 h-full bg-foreground/50"
              style={{ left: `${Math.min((line / (line * 1.5)) * 100, 100)}%` }}
            />
          </div>

          {/* Game info and projection */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {gameStatus === 'final' ? 'Final' : 
               gameInfo ? `${gameInfo.period} • ${gameInfo.clock}` : ''}
            </span>
            {projectedFinal !== null && gameStatus === 'in_progress' && (
              <span className={cn(
                'font-medium',
                projectedFinal >= line ? 'text-chart-2' : 'text-muted-foreground'
              )}>
                Proj: {projectedFinal}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Game score for in-progress */}
      {gameInfo && gameStatus === 'in_progress' && (
        <div className="mt-2 pt-2 border-t border-border/30">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{gameInfo.awayTeam}</span>
            <span className="font-medium tabular-nums">
              {gameInfo.awayScore} - {gameInfo.homeScore}
            </span>
            <span className="text-muted-foreground">{gameInfo.homeTeam}</span>
          </div>
        </div>
      )}
    </div>
  );
}

import React from 'react';
import { useLiveScores, LiveGame } from '@/hooks/useLiveScores';
import { cn } from '@/lib/utils';
import { Radio, Loader2 } from 'lucide-react';

interface LiveScoresTickerProps {
  className?: string;
  onGameClick?: (game: LiveGame) => void;
}

const SPORT_ICONS: Record<string, string> = {
  NBA: '🏀',
  NFL: '🏈',
  NHL: '🏒',
  MLB: '⚾',
  NCAAB: '🏀',
  NCAAF: '🏈',
};

export function LiveScoresTicker({ className, onGameClick }: LiveScoresTickerProps) {
  const { games, liveGames, isLoading, isConnected } = useLiveScores();

  // Show only live games in the ticker
  const tickerGames = liveGames.length > 0 ? liveGames : games.filter(g => g.status !== 'final').slice(0, 5);

  if (isLoading) {
    return (
      <div className={cn('h-10 bg-card/50 border-b border-border/50 flex items-center justify-center', className)}>
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tickerGames.length === 0) {
    return null;
  }

  return (
    <div className={cn('relative h-10 bg-card/80 backdrop-blur-sm border-b border-border/50 overflow-hidden', className)}>
      {/* Live indicator */}
      <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center gap-1.5 px-3 bg-gradient-to-r from-card via-card to-transparent">
        <span className="relative flex h-2 w-2">
          <span className={cn(
            "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
            isConnected ? "bg-chart-2" : "bg-muted-foreground"
          )} />
          <span className={cn(
            "relative inline-flex rounded-full h-2 w-2",
            isConnected ? "bg-chart-2" : "bg-muted-foreground"
          )} />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {liveGames.length > 0 ? `${liveGames.length} Live` : 'Scores'}
        </span>
      </div>

      {/* Scrolling content */}
      <div className="ticker-wrapper h-full flex items-center pl-20">
        <div className="ticker-content flex items-center gap-6 whitespace-nowrap">
          {/* Duplicate games for seamless loop */}
          {[...tickerGames, ...tickerGames].map((game, index) => {
            const isLive = game.status === 'in_progress' || game.status === 'halftime';
            const homeWinning = game.homeScore > game.awayScore;
            const awayWinning = game.awayScore > game.homeScore;

            return (
              <div
                key={`${game.eventId}-${index}`}
                className={cn(
                  'flex items-center gap-2 text-sm cursor-pointer hover:text-foreground transition-colors',
                  onGameClick && 'hover:underline'
                )}
                onClick={() => onGameClick?.(game)}
              >
                {isLive && (
                  <Radio className="w-3 h-3 text-destructive animate-pulse" />
                )}
                <span className="text-muted-foreground">{SPORT_ICONS[game.sport]}</span>
                <span className={cn(
                  'font-medium',
                  awayWinning && 'text-chart-2'
                )}>
                  {game.awayTeam.split(' ').pop()} {game.awayScore}
                </span>
                <span className="text-muted-foreground">-</span>
                <span className={cn(
                  'font-medium',
                  homeWinning && 'text-chart-2'
                )}>
                  {game.homeScore} {game.homeTeam.split(' ').pop()}
                </span>
                {isLive && game.period && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {game.period} {game.clock}
                  </span>
                )}
                {game.status === 'final' && (
                  <span className="text-xs text-muted-foreground">F</span>
                )}
                <span className="text-border">•</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right fade */}
      <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-card to-transparent pointer-events-none" />

      {/* Ticker animation styles */}
      <style>{`
        .ticker-wrapper {
          mask-image: linear-gradient(to right, transparent, black 80px, black calc(100% - 48px), transparent);
        }
        
        .ticker-content {
          animation: ticker-scroll 60s linear infinite;
        }
        
        .ticker-content:hover {
          animation-play-state: paused;
        }
        
        @keyframes ticker-scroll {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  );
}
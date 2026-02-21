import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useLiveScores, type LiveGame } from '@/hooks/useLiveScores';
import { Star } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

export interface PropsGame {
  homeTeam: string;
  awayTeam: string;
  gameDescription: string;
  commenceTime: string;
  propCount: number;
}

interface WarRoomGameStripProps {
  activeEventId?: string;
  adminEventId?: string;
  /** Games derived from unified_props / sweet spots */
  propsGames: PropsGame[];
  onSelectGame: (game: {
    eventId: string;
    homeTeam: string;
    awayTeam: string;
    gameDescription: string;
  }) => void;
}

function abbreviate(team: string): string {
  const words = team.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words[words.length - 1].slice(0, 3).toUpperCase();
}

function StatusDot({ status }: { status: LiveGame['status'] | 'pre' }) {
  if (status === 'in_progress' || status === 'halftime') {
    return (
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-destructive" />
      </span>
    );
  }
  if (status === 'final') {
    return <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />;
  }
  return <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/20" />;
}

interface MergedGame {
  homeTeam: string;
  awayTeam: string;
  gameDescription: string;
  commenceTime: string;
  propCount: number;
  liveGame?: LiveGame;
}

function GamePill({
  game,
  isActive,
  isAdminPick,
  onClick,
}: {
  game: MergedGame;
  isActive: boolean;
  isAdminPick: boolean;
  onClick: () => void;
}) {
  const live = game.liveGame;
  const isLive = live && (live.status === 'in_progress' || live.status === 'halftime');
  const isFinal = live?.status === 'final';
  const status: LiveGame['status'] | 'pre' = live?.status ?? 'pre';

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all shrink-0',
        'border',
        isActive
          ? 'border-[hsl(var(--warroom-green))] bg-[hsl(var(--warroom-green)/0.1)] text-foreground'
          : 'border-border/50 bg-card/50 text-muted-foreground hover:border-border hover:text-foreground'
      )}
    >
      {isAdminPick && (
        <Star className="w-3 h-3 text-[hsl(var(--warroom-gold))] fill-[hsl(var(--warroom-gold))]" />
      )}
      <StatusDot status={status} />
      <span className="tabular-nums">
        {abbreviate(game.awayTeam)}{' '}
        {(isLive || isFinal) && live ? (
          <span className="font-bold">{live.awayScore}</span>
        ) : null}
      </span>
      <span className="text-muted-foreground/40">@</span>
      <span className="tabular-nums">
        {abbreviate(game.homeTeam)}{' '}
        {(isLive || isFinal) && live ? (
          <span className="font-bold">{live.homeScore}</span>
        ) : null}
      </span>
      {!isLive && !isFinal && game.commenceTime && (
        <span className="text-[10px] text-muted-foreground/60">
          {new Date(game.commenceTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </span>
      )}
      {game.propCount > 0 && (
        <span className="text-[10px] text-muted-foreground/40">{game.propCount}p</span>
      )}
    </button>
  );
}

export function WarRoomGameStrip({ activeEventId, adminEventId, propsGames, onSelectGame }: WarRoomGameStripProps) {
  // Fetch live scores for status overlay (NBA only)
  const { games: liveGames } = useLiveScores({ sport: 'NBA' });

  // Merge props games with live score data
  const merged: MergedGame[] = useMemo(() => {
    return propsGames.map((pg) => {
      // Find matching live game by team names
      const matchedLive = liveGames.find((lg) => {
        const lgDesc = `${lg.awayTeam} @ ${lg.homeTeam}`.toLowerCase();
        const pgDesc = pg.gameDescription.toLowerCase();
        return pgDesc === lgDesc ||
          (lg.homeTeam.toLowerCase().includes(pg.homeTeam.toLowerCase().split(' ').pop() || '') &&
           lg.awayTeam.toLowerCase().includes(pg.awayTeam.toLowerCase().split(' ').pop() || ''));
      });
      return { ...pg, liveGame: matchedLive };
    });
  }, [propsGames, liveGames]);

  // Sort: live first, then by commence time
  const sorted = useMemo(() => {
    return [...merged].sort((a, b) => {
      const aLive = a.liveGame?.status === 'in_progress' || a.liveGame?.status === 'halftime';
      const bLive = b.liveGame?.status === 'in_progress' || b.liveGame?.status === 'halftime';
      if (aLive && !bLive) return -1;
      if (!aLive && bLive) return 1;
      return new Date(a.commenceTime).getTime() - new Date(b.commenceTime).getTime();
    });
  }, [merged]);

  if (sorted.length === 0) return null;

  return (
    <ScrollArea className="w-full">
      <div className="flex gap-1.5 pb-2">
        {sorted.map((game) => {
          const eventId = game.liveGame?.eventId || game.gameDescription;
          return (
            <GamePill
              key={game.gameDescription}
              game={game}
              isActive={activeEventId === eventId || activeEventId === game.gameDescription}
              isAdminPick={adminEventId === eventId || adminEventId === game.gameDescription}
              onClick={() =>
                onSelectGame({
                  eventId: game.liveGame?.eventId || game.gameDescription,
                  homeTeam: game.homeTeam,
                  awayTeam: game.awayTeam,
                  gameDescription: game.gameDescription,
                })
              }
            />
          );
        })}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

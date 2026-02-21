import React from 'react';
import { cn } from '@/lib/utils';
import { useLiveScores, type LiveGame } from '@/hooks/useLiveScores';
import { Star } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';

interface WarRoomGameStripProps {
  activeEventId?: string;
  adminEventId?: string;
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
  // Use last word (e.g. "Los Angeles Lakers" -> "LAK")
  return words[words.length - 1].slice(0, 3).toUpperCase();
}

function StatusDot({ status }: { status: LiveGame['status'] }) {
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

function GamePill({
  game,
  isActive,
  isAdminPick,
  onClick,
}: {
  game: LiveGame;
  isActive: boolean;
  isAdminPick: boolean;
  onClick: () => void;
}) {
  const isLive = game.status === 'in_progress' || game.status === 'halftime';
  const isFinal = game.status === 'final';

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
      <StatusDot status={game.status} />
      <span className="tabular-nums">
        {abbreviate(game.awayTeam)}{' '}
        {isLive || isFinal ? (
          <span className="font-bold">{game.awayScore}</span>
        ) : null}
      </span>
      <span className="text-muted-foreground/40">@</span>
      <span className="tabular-nums">
        {abbreviate(game.homeTeam)}{' '}
        {isLive || isFinal ? (
          <span className="font-bold">{game.homeScore}</span>
        ) : null}
      </span>
      {!isLive && !isFinal && (
        <span className="text-[10px] text-muted-foreground/60">
          {new Date(game.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </span>
      )}
    </button>
  );
}

export function WarRoomGameStrip({ activeEventId, adminEventId, onSelectGame }: WarRoomGameStripProps) {
  const { games, isLoading } = useLiveScores({ sport: 'NBA' });

  if (isLoading || games.length === 0) return null;

  // Sort: live first, then scheduled, then final
  const sorted = [...games].sort((a, b) => {
    const order = { in_progress: 0, halftime: 0, scheduled: 1, final: 2, postponed: 3 };
    const diff = (order[a.status] ?? 4) - (order[b.status] ?? 4);
    if (diff !== 0) return diff;
    return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
  });

  return (
    <ScrollArea className="w-full">
      <div className="flex gap-1.5 pb-2">
        {sorted.map((game) => (
          <GamePill
            key={game.id}
            game={game}
            isActive={activeEventId === game.eventId}
            isAdminPick={adminEventId === game.eventId}
            onClick={() =>
              onSelectGame({
                eventId: game.eventId,
                homeTeam: game.homeTeam,
                awayTeam: game.awayTeam,
                gameDescription: `${game.awayTeam} @ ${game.homeTeam}`,
              })
            }
          />
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLiveScores } from '@/hooks/useLiveScores';
import { useUnifiedLiveFeed } from '@/hooks/useUnifiedLiveFeed';
import { supabase } from '@/integrations/supabase/client';
import {
  Activity,
  Zap,
  Shield,
  Target,
  Clock,
  TrendingUp,
  Flame,
  Gauge,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { MomentumIndicator } from './warroom/MomentumIndicator';

/* ------------------------------------------------------------------ */
/*  useLivePBP – polls fetch-live-pbp for real-time box score + plays  */
/* ------------------------------------------------------------------ */
interface PBPPlayer {
  playerId: string;
  playerName: string;
  team: string;
  position: string;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  fouls: number;
  plusMinus: number;
}

interface PBPPlay {
  time: string;
  text: string;
  playType: string;
  team?: string;
  playerName?: string;
  isHighMomentum?: boolean;
}

interface PBPData {
  players: PBPPlayer[];
  recentPlays: PBPPlay[];
  period?: number;
  clock?: string;
  homeScore?: number;
  awayScore?: number;
  pace?: number;
  notAvailable?: boolean;
}

function useLivePBP(espnEventId: string | undefined, gameStatus: string | undefined) {
  const [data, setData] = useState<PBPData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Clear stale data immediately when espnEventId changes
  useEffect(() => {
    setData(null);
  }, [espnEventId]);

  const shouldPoll = espnEventId && (gameStatus === 'in_progress' || gameStatus === 'halftime');

  const fetchPBP = useCallback(async () => {
    if (!espnEventId) return;
    setIsLoading(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('fetch-live-pbp', {
        body: { eventId: espnEventId },
      });
      if (error) {
        console.error('[useLivePBP] Error:', error);
        return;
      }
      if (result && !result.notAvailable) {
        setData(result as PBPData);
      }
    } catch (err) {
      console.error('[useLivePBP] Fetch failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [espnEventId]);

  useEffect(() => {
    if (!shouldPoll) return;
    fetchPBP();
    const interval = setInterval(fetchPBP, 8000);
    return () => clearInterval(interval);
  }, [shouldPoll, fetchPBP]);

  return { data, isLoading };
}

interface CustomerLiveGamePanelProps {
  homeTeam: string;
  awayTeam: string;
  eventId: string;
  espnEventId?: string;
}

/* ------------------------------------------------------------------ */
/*  Play-type icon mapping                                             */
/* ------------------------------------------------------------------ */
const PLAY_ICONS: Record<string, React.ReactNode> = {
  dunk: <Flame className="w-3.5 h-3.5 text-primary" />,
  three_pointer: <Target className="w-3.5 h-3.5 text-primary" />,
  block: <Shield className="w-3.5 h-3.5 text-destructive" />,
  steal: <Zap className="w-3.5 h-3.5 text-warning" />,
  layup: <Activity className="w-3.5 h-3.5 text-muted-foreground" />,
  jumper: <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />,
};

const HIGH_MOMENTUM_PLAYS = new Set(['dunk', 'block', 'three_pointer']);

/* ------------------------------------------------------------------ */
/*  Scoreboard                                                         */
/* ------------------------------------------------------------------ */
function LiveScoreboard({
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  period,
  clock,
  status,
  quarterScores,
  pace,
}: {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  period: string | null;
  clock: string | null;
  status: string;
  quarterScores: Record<string, { period: number; score: number }[]>;
  pace?: number;
}) {
  const isLive = status === 'in_progress';
  const isHalf = status === 'halftime';

  return (
    <div className="p-4 space-y-3">
      {/* Status badge */}
      <div className="flex items-center justify-center gap-2">
        {isLive && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
          </span>
        )}
        <span
          className={cn(
            'text-[10px] font-bold uppercase tracking-widest',
            isLive && 'text-destructive',
            isHalf && 'text-warning',
            status === 'final' && 'text-muted-foreground',
            status === 'scheduled' && 'text-muted-foreground'
          )}
        >
          {isLive
            ? `LIVE — ${period ?? ''} ${clock ?? ''}`
            : isHalf
              ? 'HALFTIME'
              : status === 'final'
                ? 'FINAL'
                : 'SCHEDULED'}
        </span>
      </div>

      {/* Big scores */}
      <div className="flex items-center justify-center gap-6">
        <div className="text-center space-y-0.5">
          <p className="text-xs text-muted-foreground font-medium truncate max-w-[100px]">
            {awayTeam}
          </p>
          <motion.p
            key={`away-${awayScore}`}
            initial={{ scale: 1.3, color: 'hsl(var(--primary))' }}
            animate={{ scale: 1, color: 'hsl(var(--foreground))' }}
            transition={{ duration: 0.4 }}
            className={cn(
              'text-3xl font-black tabular-nums',
              awayScore > homeScore && 'drop-shadow-[0_0_12px_hsl(var(--warroom-green)/0.4)]'
            )}
          >
            {awayScore}
          </motion.p>
        </div>

        <span className="text-muted-foreground/40 text-lg font-light">@</span>

        <div className="text-center space-y-0.5">
          <p className="text-xs text-muted-foreground font-medium truncate max-w-[100px]">
            {homeTeam}
          </p>
          <motion.p
            key={`home-${homeScore}`}
            initial={{ scale: 1.3, color: 'hsl(var(--primary))' }}
            animate={{ scale: 1, color: 'hsl(var(--foreground))' }}
            transition={{ duration: 0.4 }}
            className={cn(
              'text-3xl font-black tabular-nums',
              homeScore > awayScore && 'drop-shadow-[0_0_12px_hsl(var(--warroom-green)/0.4)]'
            )}
          >
            {homeScore}
          </motion.p>
        </div>
      </div>

      {/* Momentum + Pace */}
      {isLive && (
        <div className="flex items-center justify-center gap-4">
          <MomentumIndicator homeScore={homeScore} awayScore={awayScore} />
          {pace && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Gauge className="w-3 h-3" />
              <span>Pace: <span className="text-foreground font-medium">{Math.round(pace)}</span></span>
            </div>
          )}
        </div>
      )}

      {/* Quarter scores */}
      {Object.keys(quarterScores).length > 0 && (
        <div className="flex justify-center">
          <div className="flex gap-px rounded overflow-hidden text-[10px]">
            {['away', 'home'].map((side) => {
              const scores = quarterScores[side === 'away' ? awayTeam : homeTeam] ?? [];
              return (
                <div key={side} className="flex gap-px">
                  {scores.map((q) => (
                    <span
                      key={q.period}
                      className="w-7 text-center py-0.5 bg-muted/50 text-muted-foreground tabular-nums"
                    >
                      {q.score}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Box Score Table                                                     */
/* ------------------------------------------------------------------ */
function BoxScoreTable({
  playerStats,
  homeTeam,
  awayTeam,
}: {
  playerStats: { playerName: string; team: string; points?: number; rebounds?: number; assists?: number; minutes?: string; [key: string]: any }[];
  homeTeam: string;
  awayTeam: string;
}) {
  const grouped = useMemo(() => {
    const home = playerStats
      .filter((p) => p.team?.toLowerCase().includes(homeTeam.toLowerCase().slice(0, 5)))
      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
      .slice(0, 6);
    const away = playerStats
      .filter((p) => p.team?.toLowerCase().includes(awayTeam.toLowerCase().slice(0, 5)))
      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
      .slice(0, 6);
    // If team matching fails, just split by team name
    if (home.length === 0 && away.length === 0) {
      const teams = [...new Set(playerStats.map((p) => p.team))];
      const t1 = playerStats.filter((p) => p.team === teams[0]).sort((a, b) => (b.points ?? 0) - (a.points ?? 0)).slice(0, 6);
      const t2 = playerStats.filter((p) => p.team === teams[1]).sort((a, b) => (b.points ?? 0) - (a.points ?? 0)).slice(0, 6);
      return [
        { label: teams[0] ?? awayTeam, players: t1 },
        { label: teams[1] ?? homeTeam, players: t2 },
      ];
    }
    return [
      { label: awayTeam, players: away },
      { label: homeTeam, players: home },
    ];
  }, [playerStats, homeTeam, awayTeam]);

  if (playerStats.length === 0) {
    return (
      <div className="p-3 text-center text-xs text-muted-foreground">
        Box score data arriving…
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-[260px]">
      <div className="space-y-3 p-3">
        {grouped.map((team) => (
          <div key={team.label}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              {team.label}
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground/70 text-[10px]">
                  <th className="text-left font-medium pb-1 pr-2">Player</th>
                  <th className="text-right font-medium pb-1 w-8">PTS</th>
                  <th className="text-right font-medium pb-1 w-8">REB</th>
                  <th className="text-right font-medium pb-1 w-8">AST</th>
                  <th className="text-right font-medium pb-1 w-8">MIN</th>
                </tr>
              </thead>
              <tbody>
                {team.players.map((p, i) => (
                  <tr
                    key={p.playerName}
                    className={cn(i === 0 && 'text-primary font-semibold')}
                  >
                    <td className="py-0.5 pr-2 truncate max-w-[110px]">
                      {p.playerName}
                    </td>
                    <td className="text-right tabular-nums py-0.5">
                      {p.points ?? '-'}
                    </td>
                    <td className="text-right tabular-nums py-0.5">
                      {p.rebounds ?? '-'}
                    </td>
                    <td className="text-right tabular-nums py-0.5">
                      {p.assists ?? '-'}
                    </td>
                    <td className="text-right tabular-nums py-0.5 text-muted-foreground">
                      {p.minutes ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

/* ------------------------------------------------------------------ */
/*  Play-by-Play Feed                                                  */
/* ------------------------------------------------------------------ */
interface RecentPlay {
  id?: string;
  playType?: string;
  description?: string;
  clock?: string;
  period?: number;
  team?: string;
}

function PlayByPlayFeed({ plays }: { plays: RecentPlay[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [plays.length]);

  if (plays.length === 0) {
    return (
      <div className="p-3 text-center text-xs text-muted-foreground">
        Plays will appear here once the game starts…
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-[200px]" ref={scrollRef}>
      <div className="space-y-1 p-3">
        <AnimatePresence initial={false}>
          {plays.slice(0, 8).map((play, idx) => {
            const isMomentum = HIGH_MOMENTUM_PLAYS.has(play.playType ?? '');
            return (
              <motion.div
                key={play.id ?? `play-${idx}`}
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.25 }}
                className={cn(
                  'flex items-start gap-2 py-1.5 px-2 rounded text-xs',
                  isMomentum && 'ring-1 ring-primary/30 bg-primary/5'
                )}
              >
                <span className="mt-0.5 shrink-0">
                  {PLAY_ICONS[play.playType ?? ''] ?? (
                    <Activity className="w-3.5 h-3.5 text-muted-foreground/50" />
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-foreground leading-snug">
                    {play.description ?? 'Play'}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {play.period ? `Q${play.period}` : ''}{' '}
                    {play.clock ?? ''}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ScrollArea>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Panel                                                         */
/* ------------------------------------------------------------------ */
export function CustomerLiveGamePanel({
  homeTeam,
  awayTeam,
  eventId,
  espnEventId,
}: CustomerLiveGamePanelProps) {
  // Try ESPN event ID first (live_game_scores uses ESPN IDs), fall back to odds API eventId
  const primaryEventId = espnEventId || eventId;
  const { games: eventGames, isLoading: scoresLoading } = useLiveScores({ eventId: primaryEventId });
  // Also fetch all games so we can match by team name as fallback
  const { games: allGames } = useLiveScores({});
  const { games: feedGames, isLoading: feedLoading } = useUnifiedLiveFeed({
    eventIds: [primaryEventId],
  });

  // Try event ID match first, then fall back to team name matching
  const game = eventGames[0] ?? allGames.find(g => {
    const h = g.homeTeam.toLowerCase();
    const a = g.awayTeam.toLowerCase();
    return (h.includes(homeTeam.toLowerCase().split(' ').pop()!) || homeTeam.toLowerCase().includes(h.split(' ').pop()!)) &&
           (a.includes(awayTeam.toLowerCase().split(' ').pop()!) || awayTeam.toLowerCase().includes(a.split(' ').pop()!));
  });
  const feedGame = feedGames[0];

  // Poll fetch-live-pbp for real-time play-by-play + box score from ESPN
  const { data: pbpData } = useLivePBP(espnEventId, game?.status);

  // Map PBP plays to component's RecentPlay interface
  const recentPlays: RecentPlay[] = useMemo(() => {
    if (!pbpData?.recentPlays?.length) return [];
    return pbpData.recentPlays.map((play, idx) => {
      // Parse time string like "Q2 8:45" into period + clock
      const timeMatch = play.time?.match(/^(?:Q|OT)(\d+)\s+(.+)$/);
      const period = timeMatch ? parseInt(timeMatch[1]) : undefined;
      const clock = timeMatch ? timeMatch[2] : play.time;
      return {
        id: `pbp-${idx}`,
        playType: play.playType,
        description: play.text,
        clock,
        period,
        team: play.team,
      };
    });
  }, [pbpData?.recentPlays]);

  // Box score: prefer fresh PBP player stats over stale DB data
  const boxScoreStats = useMemo(() => {
    if (pbpData?.players?.length) {
      return pbpData.players.map(p => ({
        playerName: p.playerName,
        team: p.team,
        points: p.points,
        rebounds: p.rebounds,
        assists: p.assists,
        minutes: String(Math.round(p.minutes)),
      }));
    }
    return game?.playerStats ?? [];
  }, [pbpData?.players, game?.playerStats]);

  // Waiting state
  if (scoresLoading && !game) {
    return (
      <Card className="border-border/50 overflow-hidden animate-fade-in">
        <CardContent className="p-0">
          <div className="aspect-video bg-muted/30 flex items-center justify-center">
            <div className="text-center space-y-2">
              <Clock className="w-8 h-8 mx-auto text-muted-foreground/40 animate-pulse" />
              <p className="text-sm text-muted-foreground">
                {awayTeam} @ {homeTeam}
              </p>
              <p className="text-xs text-muted-foreground/60">
                Waiting for game data…
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!game) {
    return (
      <Card className="warroom-card overflow-hidden border-0">
        <CardContent className="p-0">
          <div className="p-6 flex items-center justify-center min-h-[140px]">
            <div className="text-center space-y-3">
              <div className="flex items-center justify-center gap-4">
                <span className="text-sm font-medium text-muted-foreground">{awayTeam}</span>
                <span className="text-muted-foreground/40 text-xs">@</span>
                <span className="text-sm font-medium text-muted-foreground">{homeTeam}</span>
              </div>
              <div className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-t-primary border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin" />
                <p className="text-xs text-muted-foreground/60">
                  Loading game data…
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card key={primaryEventId} className="warroom-card overflow-hidden animate-fade-in border-0">
      <CardContent className="p-0 divide-y divide-[hsl(var(--warroom-card-border)/0.5)]">
        {/* Scoreboard */}
        <LiveScoreboard
          homeTeam={game.homeTeam}
          awayTeam={game.awayTeam}
          homeScore={pbpData?.homeScore ?? game.homeScore}
          awayScore={pbpData?.awayScore ?? game.awayScore}
          period={pbpData?.period ? `Q${pbpData.period}` : game.period}
          clock={pbpData?.clock ?? game.clock}
          status={game.status}
          quarterScores={game.quarterScores}
          pace={pbpData?.pace ?? feedGame?.pace}
        />

        {/* Box Score */}
        <div>
          <div className="px-3 pt-2 pb-1 flex items-center gap-1.5">
            <Activity className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Box Score
            </span>
          </div>
          <BoxScoreTable
            playerStats={boxScoreStats}
            homeTeam={game.homeTeam}
            awayTeam={game.awayTeam}
          />
        </div>

        {/* Play-by-Play */}
        <div>
          <div className="px-3 pt-2 pb-1 flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Play-by-Play
            </span>
          </div>
          <PlayByPlayFeed plays={recentPlays} />
        </div>
      </CardContent>
    </Card>
  );
}

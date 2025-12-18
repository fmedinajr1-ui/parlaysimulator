import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Clock, Radio, CheckCircle, AlertTriangle } from "lucide-react";
import { formatDistanceToNowStrict, differenceInMinutes, parseISO } from "date-fns";

interface GameStatusBadgeProps {
  status?: 'scheduled' | 'live' | 'final' | 'postponed';
  gameStartTime?: string;
  homeTeam?: string;
  awayTeam?: string;
  homeScore?: number;
  awayScore?: number;
  clock?: string;
  period?: string;
  outcome?: string;
  actualValue?: number;
  compact?: boolean;
}

export function GameStatusBadge({
  status = 'scheduled',
  gameStartTime,
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  clock,
  period,
  outcome,
  actualValue,
  compact = false,
}: GameStatusBadgeProps) {
  const [countdown, setCountdown] = useState<string>('');

  // Update countdown for scheduled games
  useEffect(() => {
    if (status !== 'scheduled' || !gameStartTime) return;

    const updateCountdown = () => {
      try {
        const startTime = parseISO(gameStartTime);
        const now = new Date();
        const minutesUntil = differenceInMinutes(startTime, now);

        if (minutesUntil < 0) {
          setCountdown('Starting soon');
        } else if (minutesUntil < 60) {
          setCountdown(`${minutesUntil}m`);
        } else {
          setCountdown(formatDistanceToNowStrict(startTime, { addSuffix: false }));
        }
      } catch {
        setCountdown('');
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 30000); // Update every 30s

    return () => clearInterval(interval);
  }, [status, gameStartTime]);

  // Format period display
  const formatPeriod = (p?: string) => {
    if (!p) return '';
    const num = parseInt(p);
    if (num === 1) return '1st';
    if (num === 2) return '2nd';
    if (num === 3) return '3rd';
    if (num === 4) return '4th';
    if (num > 4) return `OT${num - 4}`;
    return p;
  };

  // Compact mode for card headers
  if (compact) {
    switch (status) {
      case 'live':
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30 animate-pulse">
            <Radio className="h-3 w-3 mr-1" />
            LIVE
          </Badge>
        );
      case 'final':
        return (
          <Badge className={`${
            outcome === 'hit' 
              ? 'bg-green-500/20 text-green-400 border-green-500/30' 
              : outcome === 'miss'
              ? 'bg-red-500/20 text-red-400 border-red-500/30'
              : 'bg-muted text-muted-foreground border-border'
          }`}>
            <CheckCircle className="h-3 w-3 mr-1" />
            FINAL
          </Badge>
        );
      case 'postponed':
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            <AlertTriangle className="h-3 w-3 mr-1" />
            PPD
          </Badge>
        );
      default:
        return countdown ? (
          <Badge variant="outline" className="text-muted-foreground">
            <Clock className="h-3 w-3 mr-1" />
            {countdown}
          </Badge>
        ) : null;
    }
  }

  // Full display mode
  switch (status) {
    case 'live':
      return (
        <div className="flex flex-col gap-1 bg-red-500/10 border border-red-500/30 rounded-lg p-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            <span className="text-xs font-medium text-red-400">LIVE</span>
            {period && clock && (
              <span className="text-xs text-muted-foreground">
                {formatPeriod(period)} {clock}
              </span>
            )}
          </div>
          {homeTeam && awayTeam && (
            <div className="flex items-center justify-between text-sm">
              <span className="truncate max-w-[80px]">{homeTeam}</span>
              <span className="font-bold mx-2">
                {homeScore ?? 0} - {awayScore ?? 0}
              </span>
              <span className="truncate max-w-[80px] text-right">{awayTeam}</span>
            </div>
          )}
        </div>
      );

    case 'final':
      return (
        <div className={`flex flex-col gap-1 rounded-lg p-2 ${
          outcome === 'hit' 
            ? 'bg-green-500/10 border border-green-500/30' 
            : outcome === 'miss'
            ? 'bg-red-500/10 border border-red-500/30'
            : 'bg-muted/30 border border-border'
        }`}>
          <div className="flex items-center gap-2">
            <CheckCircle className={`h-3 w-3 ${
              outcome === 'hit' ? 'text-green-400' : 
              outcome === 'miss' ? 'text-red-400' : 'text-muted-foreground'
            }`} />
            <span className={`text-xs font-medium ${
              outcome === 'hit' ? 'text-green-400' : 
              outcome === 'miss' ? 'text-red-400' : 'text-muted-foreground'
            }`}>
              FINAL
            </span>
            {actualValue !== undefined && (
              <span className="text-xs text-muted-foreground ml-auto">
                Actual: <span className="font-bold">{actualValue}</span>
              </span>
            )}
          </div>
          {homeTeam && awayTeam && (
            <div className="flex items-center justify-between text-sm">
              <span className={`truncate max-w-[80px] ${
                homeScore !== undefined && awayScore !== undefined && homeScore > awayScore 
                  ? 'font-semibold' : ''
              }`}>{homeTeam}</span>
              <span className="font-bold mx-2">
                {homeScore ?? 0} - {awayScore ?? 0}
              </span>
              <span className={`truncate max-w-[80px] text-right ${
                homeScore !== undefined && awayScore !== undefined && awayScore > homeScore 
                  ? 'font-semibold' : ''
              }`}>{awayTeam}</span>
            </div>
          )}
        </div>
      );

    case 'postponed':
      return (
        <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-2">
          <AlertTriangle className="h-4 w-4 text-yellow-400" />
          <span className="text-sm text-yellow-400 font-medium">POSTPONED</span>
        </div>
      );

    default:
      return gameStartTime ? (
        <div className="flex items-center gap-2 bg-muted/30 border border-border rounded-lg p-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">Starts in</span>
            <span className="text-sm font-medium">{countdown || 'TBD'}</span>
          </div>
        </div>
      ) : null;
  }
}

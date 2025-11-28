import { useState, useEffect } from 'react';
import { Clock, Play, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GameCountdownProps {
  eventStartTime?: string | null;
  isSettled?: boolean;
  isWon?: boolean | null;
  className?: string;
}

export function GameCountdown({ eventStartTime, isSettled, isWon, className }: GameCountdownProps) {
  const [timeLeft, setTimeLeft] = useState<string>('');
  const [status, setStatus] = useState<'upcoming' | 'live' | 'finished'>('upcoming');

  useEffect(() => {
    if (!eventStartTime) return;

    const updateCountdown = () => {
      const now = new Date();
      const start = new Date(eventStartTime);
      const diff = start.getTime() - now.getTime();

      if (isSettled) {
        setStatus('finished');
        setTimeLeft('');
        return;
      }

      if (diff <= 0) {
        // Game has started
        const hoursSinceStart = Math.abs(diff) / (1000 * 60 * 60);
        if (hoursSinceStart < 4) {
          setStatus('live');
          setTimeLeft('LIVE');
        } else {
          setStatus('finished');
          setTimeLeft('Awaiting results');
        }
        return;
      }

      setStatus('upcoming');

      // Calculate time components
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h`);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m`);
      } else if (minutes > 0) {
        setTimeLeft(`${minutes}m ${seconds}s`);
      } else {
        setTimeLeft(`${seconds}s`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [eventStartTime, isSettled]);

  if (!eventStartTime && !isSettled) {
    return null;
  }

  if (isSettled) {
    return (
      <div className={cn(
        'flex items-center gap-1.5 text-xs font-medium',
        isWon ? 'text-green-500' : 'text-red-500',
        className
      )}>
        <CheckCircle className="w-3.5 h-3.5" />
        <span>{isWon ? 'WON' : 'LOST'}</span>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex items-center gap-1.5 text-xs font-medium',
      status === 'live' && 'text-yellow-500 animate-pulse',
      status === 'upcoming' && 'text-muted-foreground',
      status === 'finished' && 'text-orange-500',
      className
    )}>
      {status === 'live' ? (
        <>
          <Play className="w-3.5 h-3.5 fill-current" />
          <span className="font-bold">{timeLeft}</span>
        </>
      ) : status === 'upcoming' ? (
        <>
          <Clock className="w-3.5 h-3.5" />
          <span>{timeLeft}</span>
        </>
      ) : (
        <>
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{timeLeft}</span>
        </>
      )}
    </div>
  );
}

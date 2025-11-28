import { cn } from '@/lib/utils';

interface LiveStatusBadgeProps {
  status: 'scheduled' | 'in_progress' | 'final' | 'pending';
  score?: string;
  className?: string;
}

export function LiveStatusBadge({ status, score, className }: LiveStatusBadgeProps) {
  if (status === 'scheduled') {
    return (
      <span className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase',
        'bg-muted text-muted-foreground',
        className
      )}>
        Scheduled
      </span>
    );
  }

  if (status === 'in_progress') {
    return (
      <span className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase',
        'bg-red-500/20 text-red-500 animate-pulse',
        className
      )}>
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
        LIVE
        {score && <span className="ml-1 text-foreground">{score}</span>}
      </span>
    );
  }

  if (status === 'final') {
    return (
      <span className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase',
        'bg-green-500/20 text-green-500',
        className
      )}>
        Final
        {score && <span className="ml-1">{score}</span>}
      </span>
    );
  }

  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase',
      'bg-yellow-500/20 text-yellow-500',
      className
    )}>
      Pending
    </span>
  );
}

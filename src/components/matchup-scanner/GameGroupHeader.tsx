import { useMemo } from 'react';
import { Clock, Users } from 'lucide-react';
import { formatDistanceToNow, format, parseISO, isPast } from 'date-fns';
import { cn } from '@/lib/utils';
import type { GameMatchupGroup } from '@/types/matchupScanner';

interface GameGroupHeaderProps {
  group: GameMatchupGroup;
}

export function GameGroupHeader({ group }: GameGroupHeaderProps) {
  const gameTime = useMemo(() => {
    try {
      return parseISO(group.gameTime);
    } catch {
      return new Date();
    }
  }, [group.gameTime]);
  
  const isStarted = isPast(gameTime);
  
  const timeDisplay = useMemo(() => {
    if (isStarted) {
      return 'In Progress';
    }
    
    const distance = formatDistanceToNow(gameTime, { addSuffix: false });
    return `in ${distance}`;
  }, [gameTime, isStarted]);
  
  const formattedTime = useMemo(() => {
    return format(gameTime, 'h:mm a');
  }, [gameTime]);
  
  // Count grades in this group
  const gradeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const player of group.players) {
      counts[player.overallGrade] = (counts[player.overallGrade] || 0) + 1;
    }
    return counts;
  }, [group.players]);
  
  return (
    <div className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-lg">
      <div className="flex items-center gap-3">
        <div className="font-semibold text-foreground">
          {group.gameDescription}
        </div>
        <div className={cn(
          "flex items-center gap-1 text-xs",
          isStarted ? "text-green-400" : "text-muted-foreground"
        )}>
          <Clock size={12} />
          <span>{formattedTime}</span>
          <span className="text-muted-foreground">•</span>
          <span className={cn(isStarted && "text-green-400 font-medium")}>
            {timeDisplay}
          </span>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        {/* Grade summary badges */}
        <div className="flex items-center gap-1">
          {gradeCounts['A+'] > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-400 rounded">
              {gradeCounts['A+']} A+
            </span>
          )}
          {gradeCounts['A'] > 0 && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-green-500/20 text-green-400 rounded">
              {gradeCounts['A']} A
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Users size={12} />
          <span>{group.players.length}</span>
        </div>
      </div>
    </div>
  );
}

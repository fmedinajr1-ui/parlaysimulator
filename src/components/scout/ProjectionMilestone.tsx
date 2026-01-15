import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface ProjectionSnapshot {
  gameMinute: number;
  timestamp: Date;
  projections: {
    player: string;
    prop: string;
    line: number;
    expected: number;
    confidence: number;
    lean: 'OVER' | 'UNDER';
  }[];
}

interface ProjectionMilestoneProps {
  milestones: number[];
  currentMinute: number;
  snapshots: ProjectionSnapshot[];
  onMilestoneClick?: (minute: number) => void;
  className?: string;
}

export function ProjectionMilestone({ 
  milestones, 
  currentMinute, 
  snapshots, 
  onMilestoneClick,
  className 
}: ProjectionMilestoneProps) {
  const getMilestoneStatus = (minute: number) => {
    if (currentMinute >= minute) {
      const hasSnapshot = snapshots.some(s => s.gameMinute === minute);
      return hasSnapshot ? 'captured' : 'passed';
    }
    return 'pending';
  };

  const getSnapshot = (minute: number) => {
    return snapshots.find(s => s.gameMinute === minute);
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Clock className="w-3 h-3" />
        <span>Projection Milestones</span>
        <Badge variant="outline" className="text-[10px] ml-auto">
          {snapshots.length}/{milestones.length} captured
        </Badge>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Progress bar */}
        <div className="absolute top-3 left-4 right-4 h-1 bg-muted rounded-full">
          <div 
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, (currentMinute / 48) * 100)}%` }}
          />
        </div>

        {/* Milestone dots */}
        <div className="relative flex justify-between px-2">
          {milestones.map((minute) => {
            const status = getMilestoneStatus(minute);
            const snapshot = getSnapshot(minute);
            const isHalftime = minute === 24;

            return (
              <button
                key={minute}
                onClick={() => snapshot && onMilestoneClick?.(minute)}
                disabled={!snapshot}
                className={cn(
                  "relative flex flex-col items-center gap-1 transition-all",
                  snapshot && "cursor-pointer hover:scale-110"
                )}
              >
                {/* Dot */}
                <div className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono border-2 transition-colors",
                  status === 'captured' && "bg-primary text-primary-foreground border-primary",
                  status === 'passed' && "bg-muted text-muted-foreground border-muted-foreground/50",
                  status === 'pending' && "bg-background text-muted-foreground border-border",
                  isHalftime && status === 'captured' && "bg-chart-3 border-chart-3",
                  isHalftime && status !== 'captured' && "border-chart-3/50"
                )}>
                  {isHalftime ? 'HT' : minute}
                </div>

                {/* Label */}
                <span className={cn(
                  "text-[9px] whitespace-nowrap",
                  status === 'captured' ? "text-foreground" : "text-muted-foreground"
                )}>
                  {isHalftime ? 'Halftime' : `${minute}m`}
                </span>

                {/* Snapshot indicator */}
                {snapshot && snapshot.projections.length > 0 && (
                  <Badge 
                    variant="secondary" 
                    className="absolute -top-3 left-1/2 -translate-x-1/2 text-[8px] px-1 py-0"
                  >
                    {snapshot.projections.length}
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Current progress */}
      <div className="flex items-center justify-center gap-2 text-xs">
        <span className="text-muted-foreground">Current:</span>
        <span className="font-mono font-bold">{currentMinute.toFixed(1)}m</span>
        <span className="text-muted-foreground">/ 48m</span>
      </div>
    </div>
  );
}

interface ProjectionSnapshotViewProps {
  snapshot: ProjectionSnapshot;
  className?: string;
}

export function ProjectionSnapshotView({ snapshot, className }: ProjectionSnapshotViewProps) {
  return (
    <div className={cn("space-y-2 p-3 bg-muted/50 rounded-lg", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">
          {snapshot.gameMinute === 24 ? 'Halftime' : `${snapshot.gameMinute}m`} Snapshot
        </span>
        <span className="text-muted-foreground">
          {snapshot.projections.length} projections
        </span>
      </div>

      <div className="space-y-1.5 max-h-32 overflow-y-auto">
        {snapshot.projections.map((proj, idx) => (
          <div key={idx} className="flex items-center justify-between text-xs p-1.5 bg-background rounded">
            <div className="flex items-center gap-2">
              <span className="font-medium">{proj.player.split(' ').pop()}</span>
              <span className="text-muted-foreground">{proj.prop}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn(
                "flex items-center gap-0.5",
                proj.lean === 'OVER' ? "text-chart-2" : "text-destructive"
              )}>
                {proj.lean === 'OVER' ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {proj.expected.toFixed(1)}
              </span>
              <span className="text-muted-foreground">vs {proj.line}</span>
              <Badge variant="outline" className="text-[10px]">
                {proj.confidence}%
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Helper to parse game time string into total elapsed minutes
export function parseGameMinutes(gameTime: string): number {
  // Format: "Q2 5:42" -> 12 + (12 - 5.7) = 18.3 minutes elapsed
  const match = gameTime?.match(/Q(\d)\s+(\d+):(\d+)/);
  if (!match) return 0;
  
  const quarter = parseInt(match[1]);
  const mins = parseInt(match[2]);
  const secs = parseInt(match[3]);
  
  // Each quarter is 12 minutes, clock counts down
  const quarterMinutes = 12 - mins - (secs / 60);
  return ((quarter - 1) * 12) + quarterMinutes;
}

// Standard milestones: 5, 10, 15, 20, 24 (HT), 30, 36, 42, 48
export const PROJECTION_MILESTONES = [5, 10, 15, 20, 24, 30, 36, 42, 48];

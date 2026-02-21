import React from 'react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip';

interface FatigueRingProps {
  fatiguePercent: number; // 0-100
  size?: number; // diameter in px
  className?: string;
}

export function FatigueRing({ fatiguePercent, size = 36, className }: FatigueRingProps) {
  const clamped = Math.min(100, Math.max(0, fatiguePercent));
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;

  // Color based on fatigue level
  const color =
    clamped <= 40
      ? 'hsl(var(--warroom-green))'
      : clamped <= 70
        ? 'hsl(var(--warroom-gold))'
        : 'hsl(var(--warroom-danger))';

  const isHigh = clamped > 75;
  const efficiencyDrop = Math.round(clamped * 0.12); // ~12% drop at 100% fatigue

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'relative flex items-center justify-center shrink-0',
              isHigh && 'warroom-fatigue-pulse',
              className
            )}
            style={{ width: size, height: size }}
          >
            <svg width={size} height={size} className="-rotate-90">
              {/* Background ring */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="hsl(var(--warroom-card-border))"
                strokeWidth={strokeWidth}
              />
              {/* Filled ring */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                className="transition-all duration-700"
              />
            </svg>
            <span
              className="absolute text-[9px] font-bold tabular-nums"
              style={{ color }}
            >
              {Math.round(clamped)}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p>Fatigue: {Math.round(clamped)}%</p>
          {isHigh && (
            <p className="text-[hsl(var(--warroom-danger))]">
              Projected efficiency drop: -{efficiencyDrop}%
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
